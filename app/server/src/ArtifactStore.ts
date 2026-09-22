import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { ArtifactReference, StageKind } from "@aios/contracts";

export interface ArtifactActivity { id: string; artifact: ArtifactReference; occurredAt: string; }
interface ArtifactDocument { schemaVersion: number; artifacts: ArtifactReference[]; activity?: ArtifactActivity[]; }
export interface ArtifactActivityStore { recordArtifactWritten(artifact: ArtifactReference): void; }
export interface ArtifactStore { list(workItemId: string, stageKind?: StageKind): ArtifactReference[]; get(id: string): ArtifactReference | undefined; save(artifact: ArtifactReference): void; update(id: string, update: Partial<Pick<ArtifactReference, "approvalState" | "rejectionNote">>): ArtifactReference | undefined; activityEntries(): ArtifactActivity[]; setActivityStore(activityStore: ArtifactActivityStore): void; }
export class FileArtifactStore implements ArtifactStore {
  private readonly artifacts: ArtifactReference[];
  private readonly activity: ArtifactActivity[];
  private activityStore: ArtifactActivityStore | undefined;
  constructor(private readonly path: string) { const document = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) as ArtifactDocument : { artifacts: [], activity: [] }; this.artifacts = document.artifacts; this.activity = document.activity ?? []; }
  setActivityStore(activityStore: ArtifactActivityStore): void { this.activityStore = activityStore; }
  list(workItemId: string, stageKind?: StageKind): ArtifactReference[] { return clone(this.artifacts.filter((artifact) => artifact.workItemId === workItemId && (!stageKind || artifact.stageKind === stageKind))); }
  get(id: string): ArtifactReference | undefined { const artifact = this.artifacts.find((candidate) => candidate.id === id); return artifact ? clone(artifact) : undefined; }
  activityEntries(): ArtifactActivity[] { return clone(this.activity); }
  update(id: string, update: Partial<Pick<ArtifactReference, "approvalState" | "rejectionNote">>): ArtifactReference | undefined { const index = this.artifacts.findIndex((artifact) => artifact.id === id); if (index < 0) return undefined; this.artifacts[index] = { ...this.artifacts[index], ...update }; this.persist(); return clone(this.artifacts[index]); }
  save(artifact: ArtifactReference): void {
    const entry = { id: artifact.id, artifact: clone(artifact), occurredAt: new Date().toISOString() };
    this.artifacts.push(clone(artifact)); this.activity.push(entry);
    this.persist();
    try { this.activityStore?.recordArtifactWritten(artifact); }
    catch (error) { this.artifacts.pop(); this.activity.pop(); this.persist(); throw error; }
  }
  private persist(): void { mkdirSync(dirname(this.path), { recursive: true }); const tmp = `${this.path}.${process.pid}.tmp`; writeFileSync(tmp, JSON.stringify({ schemaVersion: 1, artifacts: this.artifacts, activity: this.activity }, null, 2)); renameSync(tmp, this.path); }
}
function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
