import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import type { WorkItem } from "@aios/contracts";

interface WorkItemDocument { schemaVersion: number; workItems: WorkItem[]; }

export interface WorkItemStore {
  list(): WorkItem[];
  create(input: { title: string; repositories: string[] }): WorkItem;
}

export class FileWorkItemStore implements WorkItemStore {
  private workItems: WorkItem[];

  constructor(private readonly filePath: string) {
    this.workItems = this.load();
  }

  list(): WorkItem[] { return clone(this.workItems); }

  create(input: { title: string; repositories: string[] }): WorkItem {
    const workItem: WorkItem = {
      id: randomUUID(), title: input.title.trim(), repositories: [...input.repositories],
      workSourceKey: null, track: null, createdAt: new Date().toISOString()
    };
    this.workItems.push(workItem);
    this.persist();
    return clone(workItem);
  }

  private load(): WorkItem[] {
    if (!existsSync(this.filePath)) return [];
    const parsed = JSON.parse(readFileSync(this.filePath, "utf8")) as WorkItemDocument;
    if (!parsed || typeof parsed.schemaVersion !== "number" || !Array.isArray(parsed.workItems)) throw new Error(`Invalid work-item store document: ${this.filePath}`);
    if (parsed.schemaVersion > 1) throw new Error(`Work-item store schema version ${parsed.schemaVersion} is newer than supported version 1`);
    if (parsed.schemaVersion !== 1) throw new Error(`Invalid work-item store document: ${this.filePath}`);
    return clone(parsed.workItems);
  }

  private persist(): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.${process.pid}.tmp`;
    writeFileSync(temporaryPath, JSON.stringify({ schemaVersion: 1, workItems: this.workItems }, null, 2));
    renameSync(temporaryPath, this.filePath);
  }
}

function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
