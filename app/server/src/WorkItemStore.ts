import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import type { Stage, StageKind, StageState, WorkItem } from "@aios/contracts";
import { runMigrations, type StoreMigration } from "./StoreMigrations.js";

export interface StageActivity { id: string; workItemId: string; stageKind: StageKind; state: StageState; occurredAt: string; }
interface WorkItemDocument { schemaVersion: number; workItems: WorkItem[]; stageActivity?: StageActivity[]; }
const SCHEMA_VERSION = 3;
const MIGRATIONS: ReadonlyArray<StoreMigration<WorkItemDocument>> = [
  { fromVersion: 1, migrate: (document) => ({ ...document, schemaVersion: 2, workItems: document.workItems.map((workItem) => ({ ...workItem, stages: workItem.stages ?? [] })) }) },
  { fromVersion: 2, migrate: (document) => ({ ...document, schemaVersion: 3, stageActivity: document.stageActivity ?? [] }) }
];

export interface WorkItemStore {
  list(): WorkItem[];
  create(input: { title: string; repositories: string[] }): WorkItem;
  import(input: { workSourceKey: string; title: string }): WorkItem | null;
  approveTrack(workItemId: string, stages: StageKind[]): WorkItem;
  setStageState(workItemId: string, stageKind: StageKind, state: StageState): WorkItem;
  stageActivity(): StageActivity[];
}

export class FileWorkItemStore implements WorkItemStore {
  private workItems: WorkItem[];
  private activity: StageActivity[];
  private migratedOnOpen = false;

  constructor(private readonly filePath: string) {
    const document = this.load();
    this.workItems = document.workItems;
    this.activity = document.stageActivity;
    if (this.migratedOnOpen) this.persist();
  }

  list(): WorkItem[] { return clone(this.workItems); }
  stageActivity(): StageActivity[] { return clone(this.activity); }

  create(input: { title: string; repositories: string[] }): WorkItem {
    const workItem: WorkItem = {
      id: randomUUID(), title: input.title.trim(), repositories: [...input.repositories],
      workSourceKey: null, track: null, stages: [], createdAt: new Date().toISOString()
    };
    this.workItems.push(workItem);
    this.persist();
    return clone(workItem);
  }

  import(input: { workSourceKey: string; title: string }): WorkItem | null {
    if (this.workItems.some((workItem) => workItem.workSourceKey === input.workSourceKey)) return null;
    const workItem: WorkItem = { id: randomUUID(), title: input.title, repositories: [], workSourceKey: input.workSourceKey, track: null, stages: [], createdAt: new Date().toISOString() };
    this.workItems.push(workItem); this.persist(); return clone(workItem);
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

  private load(): Required<Pick<WorkItemDocument, "workItems" | "stageActivity">> {
    if (!existsSync(this.filePath)) return { workItems: [], stageActivity: [] };
    const parsed = JSON.parse(readFileSync(this.filePath, "utf8")) as WorkItemDocument;
    if (!parsed || typeof parsed.schemaVersion !== "number" || !Array.isArray(parsed.workItems)) throw new Error(`Invalid work-item store document: ${this.filePath}`);
    if (parsed.schemaVersion > SCHEMA_VERSION) throw new Error(`Work-item store schema version ${parsed.schemaVersion} is newer than supported version ${SCHEMA_VERSION}`);
    const migrated = runMigrations(parsed, SCHEMA_VERSION, MIGRATIONS);
    this.migratedOnOpen = migrated.schemaVersion !== parsed.schemaVersion;
    return { workItems: clone(migrated.workItems), stageActivity: clone(migrated.stageActivity ?? []) };
  }

  private persist(): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.${process.pid}.tmp`;
    writeFileSync(temporaryPath, JSON.stringify({ schemaVersion: SCHEMA_VERSION, workItems: this.workItems, stageActivity: this.activity }, null, 2));
    renameSync(temporaryPath, this.filePath);
  }
}

function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
