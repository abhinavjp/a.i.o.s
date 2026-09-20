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

  suggest(capabilityTag: string): { agent: AgentSlotSummary | null; reason: string | null } {
    const matches = this.list().filter((agent) => !agent.full && agent.capabilityTags.includes(capabilityTag));
    if (matches.length === 0) return { agent: null, reason: `no agent with a free slot has capability tag ${capabilityTag}` };
    return { agent: matches.sort((left, right) => (right.slotLimit - right.slotsInUse) - (left.slotLimit - left.slotsInUse))[0]!, reason: null };
  }
}
