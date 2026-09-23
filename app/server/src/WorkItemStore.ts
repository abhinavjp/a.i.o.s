import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import type { Stage, StageKind, StageState, WorkItem } from "@aios/contracts";
import { runMigrations, type StoreMigration } from "./StoreMigrations.js";

export interface StageActivity { id: string; workItemId: string; stageKind: StageKind; state: StageState; occurredAt: string; }
export interface SourceObservationInput { workSourceKey: string; title: string; state: string; observedAt: string; }
export interface SourceObservationBatchResult { imported: number; updated: number; missing: number; }
interface WorkItemDocument { schemaVersion: number; workItems: WorkItem[]; stageActivity?: StageActivity[]; }
const SCHEMA_VERSION = 4;
const MIGRATIONS: ReadonlyArray<StoreMigration<WorkItemDocument>> = [
  { fromVersion: 1, migrate: (document) => ({ ...document, schemaVersion: 2, workItems: document.workItems.map((workItem) => ({ ...workItem, stages: workItem.stages ?? [] })) }) },
  { fromVersion: 2, migrate: (document) => ({ ...document, schemaVersion: 3, stageActivity: document.stageActivity ?? [] }) },
  { fromVersion: 3, migrate: (document) => ({ ...document, schemaVersion: 4, workItems: document.workItems.map((item) => ({ ...item, sourceObservation: item.sourceObservation ?? (item.workSourceKey ? { source: "jira", status: "unobserved", lastObservedAt: null, lastCheckedAt: null, lastState: null } : null) })) }) }
];

export interface WorkItemStore {
  list(): WorkItem[];
  create(input: { title: string; repositories: string[] }): WorkItem;
  import(input: { workSourceKey: string; title: string }): WorkItem | null;
  upsertSourceObservation(input: { workSourceKey: string; title: string; state: string; observedAt: string }): WorkItem;
  markSourceMissing(observedKeys: ReadonlyArray<string>, checkedAt: string): void;
  applySourceObservationBatch(observations: ReadonlyArray<SourceObservationInput>, checkedAt: string): SourceObservationBatchResult;
  approveTrack(workItemId: string, stages: StageKind[]): WorkItem;
  insertStage(workItemId: string, stageKind: StageKind, index: number, expectedTrack: StageKind[], proposedTrack: StageKind[]): WorkItem;
  setStageState(workItemId: string, stageKind: StageKind, state: StageState): WorkItem;
  stageActivity(): StageActivity[];
}

export class FileWorkItemStore implements WorkItemStore {
  private workItems: WorkItem[];
  private activity: StageActivity[];
  private readonly documentExtras: Record<string, unknown>;
  private migratedOnOpen = false;

  constructor(private readonly filePath: string) {
    const document = this.load();
    this.workItems = document.workItems;
    this.activity = document.stageActivity;
    this.documentExtras = document.extras;
    if (this.migratedOnOpen) this.persist();
  }

  list(): WorkItem[] { return clone(this.workItems); }
  stageActivity(): StageActivity[] { return clone(this.activity); }

  create(input: { title: string; repositories: string[] }): WorkItem {
    const workItem: WorkItem = {
      id: randomUUID(), title: input.title.trim(), repositories: [...input.repositories],
      workSourceKey: null, track: null, stages: [], createdAt: new Date().toISOString(), sourceObservation: null
    };
    this.workItems.push(workItem);
    this.persist();
    return clone(workItem);
  }

  import(input: { workSourceKey: string; title: string }): WorkItem | null {
    if (this.workItems.some((workItem) => workItem.workSourceKey === input.workSourceKey)) return null;
    const workItem: WorkItem = { id: randomUUID(), title: input.title, repositories: [], workSourceKey: input.workSourceKey, track: null, stages: [], createdAt: new Date().toISOString(), sourceObservation: { source: "jira", status: "unobserved", lastObservedAt: null, lastCheckedAt: null, lastState: null } };
    this.workItems.push(workItem); this.persist(); return clone(workItem);
  }

  upsertSourceObservation(input: { workSourceKey: string; title: string; state: string; observedAt: string }): WorkItem {
    if (!input.workSourceKey.trim() || !input.title.trim() || !input.state.trim() || !Number.isFinite(Date.parse(input.observedAt))) throw new Error("source observation is incomplete");
    const index = this.workItems.findIndex((item) => item.workSourceKey === input.workSourceKey);
    const observation = { source: "jira" as const, status: "observed" as const, lastObservedAt: input.observedAt, lastCheckedAt: input.observedAt, lastState: input.state };
    if (index < 0) {
      const item: WorkItem = { id: randomUUID(), title: input.title, repositories: [], workSourceKey: input.workSourceKey, track: null, stages: [], createdAt: new Date().toISOString(), sourceObservation: observation };
      this.workItems.push(item); this.persist(); return clone(item);
    }
    const current = this.workItems[index];
    const updated = { ...current, title: input.title, sourceObservation: observation };
    if (JSON.stringify(current) !== JSON.stringify(updated)) { this.workItems[index] = updated; this.persist(); }
    return clone(updated);
  }

  applySourceObservationBatch(observations: ReadonlyArray<SourceObservationInput>, checkedAt: string): SourceObservationBatchResult {
    if (!Number.isFinite(Date.parse(checkedAt))) throw new Error("source check time is invalid");
    const observedKeys = new Set<string>();
    for (const observation of observations) {
      if (!observation.workSourceKey.trim() || !observation.title.trim() || !observation.state.trim() || !Number.isFinite(Date.parse(observation.observedAt))) throw new Error("source observation is incomplete");
      if (observedKeys.has(observation.workSourceKey)) throw new Error("source observation batch contains duplicate work-source keys");
      observedKeys.add(observation.workSourceKey);
    }

    let imported = 0;
    let updated = 0;
    let missing = 0;
    const nextWorkItems = this.workItems.map((item) => ({ ...item }));
    for (const observation of observations) {
      const index = nextWorkItems.findIndex((item) => item.workSourceKey === observation.workSourceKey);
      const sourceObservation = { source: "jira" as const, status: "observed" as const, lastObservedAt: observation.observedAt, lastCheckedAt: checkedAt, lastState: observation.state };
      if (index < 0) {
        imported += 1;
        nextWorkItems.push({ id: randomUUID(), title: observation.title, repositories: [], workSourceKey: observation.workSourceKey, track: null, stages: [], createdAt: new Date().toISOString(), sourceObservation });
      } else {
        updated += 1;
        nextWorkItems[index] = { ...nextWorkItems[index], title: observation.title, sourceObservation };
      }
    }

    const existingKeys = new Set(this.workItems.flatMap((item) => item.workSourceKey ? [item.workSourceKey] : []));
    for (const item of nextWorkItems) {
      if (!item.workSourceKey || observedKeys.has(item.workSourceKey) || item.sourceObservation?.status === "missing") continue;
      if (!existingKeys.has(item.workSourceKey)) continue;
      missing += 1;
      item.sourceObservation = { source: "jira", status: "missing", lastObservedAt: item.sourceObservation?.lastObservedAt ?? null, lastCheckedAt: checkedAt, lastState: item.sourceObservation?.lastState ?? null };
    }

    if (JSON.stringify(nextWorkItems) !== JSON.stringify(this.workItems)) {
      this.persist(nextWorkItems);
      this.workItems = nextWorkItems;
    }
    return { imported, updated, missing };
  }

  markSourceMissing(observedKeys: ReadonlyArray<string>, checkedAt: string): void {
    if (!Number.isFinite(Date.parse(checkedAt))) throw new Error("source check time is invalid");
    const seen = new Set(observedKeys);
    let changed = false;
    this.workItems = this.workItems.map((item) => {
      if (!item.workSourceKey || seen.has(item.workSourceKey) || item.sourceObservation?.status === "missing") return item;
      changed = true;
      return { ...item, sourceObservation: { source: "jira" as const, status: "missing" as const, lastObservedAt: item.sourceObservation?.lastObservedAt ?? null, lastCheckedAt: checkedAt, lastState: item.sourceObservation?.lastState ?? null } };
    });
    if (changed) this.persist();
  }

  approveTrack(workItemId: string, stageKinds: StageKind[]): WorkItem {
    const index = this.workItems.findIndex((workItem) => workItem.id === workItemId);
    if (index < 0) throw new Error("work item was not found");
    const current = this.workItems[index];
    if (current.track) throw new Error("a track has already been approved for this work item");
    const stages: Stage[] = stageKinds.map((kind) => ({ kind, state: "not-started", artifacts: [] }));
    const approved = { ...current, track: { stages: [...stageKinds] }, stages };
    this.workItems[index] = approved;
    this.persist();
    return clone(approved);
  }

  insertStage(workItemId: string, stageKind: StageKind, index: number, expectedTrack: StageKind[], proposedTrack: StageKind[]): WorkItem {
    const workItemIndex = this.workItems.findIndex((workItem) => workItem.id === workItemId);
    if (workItemIndex < 0) throw new Error("work item was not found");
    const current = this.workItems[workItemIndex];
    if (!current.track) throw new Error("a track must be approved before adding a stage");
    if (!STAGE_KINDS.includes(stageKind)) throw new Error("stage kind is invalid");
    if (current.track.stages.includes(stageKind)) throw new Error(`stage ${stageKind} is already in this work item's track`);
    if (!Number.isInteger(index) || index < 0 || index > current.track.stages.length) throw new Error("stage index is outside this work item's track");
    if (JSON.stringify(current.track.stages) !== JSON.stringify(expectedTrack)) throw new Error("the track changed after this ask was created");
    const trackStages = [...current.track.stages]; trackStages.splice(index, 0, stageKind);
    if (JSON.stringify(trackStages) !== JSON.stringify(proposedTrack)) throw new Error("the proposed track does not match this change");
    const stages = [...current.stages]; stages.splice(index, 0, { kind: stageKind, state: "not-started", artifacts: [] });
    const updated = { ...current, track: { stages: trackStages }, stages };
    this.workItems[workItemIndex] = updated;
    this.persist();
    return clone(updated);
  }

  setStageState(workItemId: string, stageKind: StageKind, state: StageState): WorkItem {
    const index = this.workItems.findIndex((workItem) => workItem.id === workItemId);
    if (index < 0) throw new Error("work item was not found");
    const current = this.workItems[index];
    if (!current.track?.stages.includes(stageKind)) throw new Error(`stage ${stageKind} is not in this work item's track`);
    const updated = { ...current, stages: current.stages.map((stage) => stage.kind === stageKind ? { ...stage, state } : stage) };
    this.workItems[index] = updated;
    if (current.stages.find((stage) => stage.kind === stageKind)?.state !== state) this.activity.push({ id: randomUUID(), workItemId, stageKind, state, occurredAt: new Date().toISOString() });
    this.persist();
    return clone(updated);
  }

  private load(): Required<Pick<WorkItemDocument, "workItems" | "stageActivity">> & { extras: Record<string, unknown> } {
    if (!existsSync(this.filePath)) return { workItems: [], stageActivity: [], extras: {} };
    const parsed = JSON.parse(readFileSync(this.filePath, "utf8")) as WorkItemDocument;
    if (!parsed || typeof parsed.schemaVersion !== "number" || !Array.isArray(parsed.workItems)) throw new Error(`Invalid work-item store document: ${this.filePath}`);
    if (parsed.schemaVersion > SCHEMA_VERSION) throw new Error(`Work-item store schema version ${parsed.schemaVersion} is newer than supported version ${SCHEMA_VERSION}`);
    const migrated = runMigrations(parsed, SCHEMA_VERSION, MIGRATIONS);
    this.migratedOnOpen = migrated.schemaVersion !== parsed.schemaVersion;
    const { schemaVersion: _schemaVersion, workItems, stageActivity, ...extras } = migrated as WorkItemDocument & Record<string, unknown>;
    return { workItems: clone(workItems), stageActivity: clone(stageActivity ?? []), extras: clone(extras) };
  }

  private persist(workItems: WorkItem[] = this.workItems): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.${process.pid}.tmp`;
    writeFileSync(temporaryPath, JSON.stringify({ ...this.documentExtras, schemaVersion: SCHEMA_VERSION, workItems, stageActivity: this.activity }, null, 2));
    renameSync(temporaryPath, this.filePath);
  }
}

const STAGE_KINDS: StageKind[] = ["functional-analysis", "technical-analysis", "spec-and-eval", "plan", "implementation", "final-review", "merge"];

function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
