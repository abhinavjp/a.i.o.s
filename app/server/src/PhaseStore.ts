import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Phase, StageKind } from "@aios/contracts";

export interface StoredPhase { workItemId: string; stageKind: StageKind; phase: Phase; }
export interface PhaseStore { list(workItemId: string): StoredPhase[]; create(input: StoredPhase): void; addTask(workItemId: string, phaseNumber: number, taskId: string): void; workItemForTask(taskId: string): string | null; }
export class FilePhaseStore implements PhaseStore {
  private readonly phases: StoredPhase[];
  constructor(private readonly path: string) { this.phases = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")).phases : []; }
  list(workItemId: string): StoredPhase[] { return clone(this.phases.filter((phase) => phase.workItemId === workItemId)); }
  workItemForTask(taskId: string): string | null { return this.phases.find((stored) => stored.phase.taskIds.includes(taskId))?.workItemId ?? null; }
  create(input: StoredPhase): void { if (input.stageKind !== "implementation") throw new Error("phases can only be added to the implementation stage"); if (!input.phase.demoSentence.trim()) throw new Error("a phase requires a demo sentence"); this.phases.push(clone(input)); this.persist(); }
  addTask(workItemId: string, phaseNumber: number, taskId: string): void {
    const stored = this.phases.find((candidate) => candidate.workItemId === workItemId && candidate.phase.number === phaseNumber);
    if (!stored) throw new Error(`phase ${phaseNumber} was not found for this work item`);
    if (stored.phase.taskIds.includes(taskId)) return;
    stored.phase = { ...stored.phase, taskIds: [...stored.phase.taskIds, taskId] };
    this.persist();
  }
  private persist(): void { mkdirSync(dirname(this.path), { recursive: true }); const tmp = `${this.path}.${process.pid}.tmp`; writeFileSync(tmp, JSON.stringify({ schemaVersion: 1, phases: this.phases }, null, 2)); renameSync(tmp, this.path); }
}
function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
