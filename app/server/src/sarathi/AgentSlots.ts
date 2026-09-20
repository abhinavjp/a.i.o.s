import type { TaskStore } from "../TaskStore.js";
import type { SarathiStore, Specialist } from "./SarathiStore.js";

export interface AgentSlotSummary extends Specialist {
  slotLimit: number;
  slotsInUse: number;
  full: boolean;
}

export class NoFreeSlotError extends Error {
  constructor() { super("agent has no free slot"); }
}

export class AgentSlotManager {
  constructor(private readonly store: SarathiStore, private readonly tasks: TaskStore) {}

  list(): AgentSlotSummary[] {
    return this.store.snapshot().specialists.map((agent) => {
      const slotLimit = agent.slotLimit ?? 1;
      const slotsInUse = this.tasks.list().filter((task) => (task.agentId ?? "sarathi") === agent.id && task.status === "running").length;
      return { ...agent, slotLimit, slotsInUse, full: slotsInUse >= slotLimit };
    });
  }

  assignedAgentId(candidate?: string): string {
    return candidate && this.list().some((agent) => agent.id === candidate) ? candidate : "sarathi";
  }

  assertFree(agentId: string): void {
    const agent = this.list().find((candidate) => candidate.id === agentId)!;
    if (agent.full) throw new NoFreeSlotError();
  }
}
