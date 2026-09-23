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

  suggest(capabilityTag: string, activeOnly = false): { agent: AgentSlotSummary | null; reason: string | null } {
    const capable = this.list().filter((agent) => (!activeOnly || agent.status === "active") && agent.capabilityTags.includes(capabilityTag));
    if (capable.length === 0) return { agent: null, reason: activeOnly ? `no active agent has capability tag ${capabilityTag}` : `no agent with a free slot has capability tag ${capabilityTag}` };
    const matches = capable.filter((agent) => !agent.full);
    if (matches.length === 0) return { agent: null, reason: activeOnly ? `all active agents with capability tag ${capabilityTag} have full slots` : `no agent with a free slot has capability tag ${capabilityTag}` };
    return { agent: matches.sort((left, right) => (right.slotLimit - right.slotsInUse) - (left.slotLimit - left.slotsInUse))[0]!, reason: null };
  }
}
