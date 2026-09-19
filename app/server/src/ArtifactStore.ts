import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { ArtifactReference, StageKind } from "@aios/contracts";

interface ArtifactDocument { schemaVersion: number; artifacts: ArtifactReference[]; }
export interface ArtifactStore { list(workItemId: string, stageKind?: StageKind): ArtifactReference[]; save(artifact: ArtifactReference): void; }
export class FileArtifactStore implements ArtifactStore {
  private readonly artifacts: ArtifactReference[];
  constructor(private readonly path: string) { this.artifacts = existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as ArtifactDocument).artifacts : []; }
  list(workItemId: string, stageKind?: StageKind): ArtifactReference[] { return clone(this.artifacts.filter((artifact) => artifact.workItemId === workItemId && (!stageKind || artifact.stageKind === stageKind))); }
  save(artifact: ArtifactReference): void { this.artifacts.push(clone(artifact)); this.persist(); }
  private persist(): void { mkdirSync(dirname(this.path), { recursive: true }); const tmp = `${this.path}.${process.pid}.tmp`; writeFileSync(tmp, JSON.stringify({ schemaVersion: 1, artifacts: this.artifacts }, null, 2)); renameSync(tmp, this.path); }
}
function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
