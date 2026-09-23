import { createHash } from "node:crypto";
import type { AgentManager } from "@aios/agents";
import { computeSessionKey } from "../sessionKey.js";
import type { TaskRunRegistry } from "../TaskRunRegistry.js";
import type { GitLabDiscussionObservation, PendingAsk, SarathiStore } from "../sarathi/SarathiStore.js";
import type { AgentSlotManager } from "../sarathi/AgentSlots.js";
import type { PermissionEngine } from "../sarathi/PermissionEngine.js";

export const GITLAB_REMEDIATION_CAPABILITY = "gitlab.discussion.remediate";

export type RemediationAdmissionResult =
  | { state: "admitted"; taskId: string }
  | { state: "blocked"; reason: string };

/** Admits only observed GitLab discussion intents through Sarathi's task runner and permission engine. */
export class RemediationAdmissionCoordinator {
  private readonly inFlight = new Map<string, Promise<RemediationAdmissionResult | undefined>>();

  constructor(
    private readonly store: SarathiStore,
    private readonly agentSlots: AgentSlotManager,
    private readonly permissionEngine: PermissionEngine,
    private readonly tasks: TaskRunRegistry,
    private readonly manager: AgentManager
  ) {}

  async preflight(ask: PendingAsk): Promise<RemediationAdmissionResult | undefined> {
    if (!isRemediationAsk(ask)) return undefined;
    const reason = this.freshnessBlockReason(ask);
    if (reason) {
      this.store.recordGitLabDiscussionAdmission(ask.intent.target, { state: "blocked", reason });
      return { state: "blocked", reason };
    }
    const suggestion = this.agentSlots.suggest(GITLAB_REMEDIATION_CAPABILITY, true);
    if (!suggestion.agent) {
      const reason = suggestion.reason ?? `no eligible agent has capability tag ${GITLAB_REMEDIATION_CAPABILITY}`;
      this.store.recordGitLabDiscussionAdmission(ask.intent.target, { state: "blocked", reason });
      return { state: "blocked", reason };
    }
    this.store.recordGitLabDiscussionAdmission(ask.intent.target, { state: "pending" });
    return undefined;
  }

  async admitApproved(ask: PendingAsk): Promise<RemediationAdmissionResult | undefined> {
    return this.runOnce(ask, "approval");
  }

  async processStandingRules(): Promise<void> {
    for (const ask of this.store.snapshot().asks) {
      if (!isRemediationAsk(ask)) continue;
      await this.runOnce(ask, "standing-rule");
    }
  }

  private runOnce(ask: PendingAsk, authority: "approval" | "standing-rule"): Promise<RemediationAdmissionResult | undefined> {
    const existing = this.inFlight.get(ask.id);
    if (existing) return existing;
    const pending = this.admitOnce(ask, authority);
    this.inFlight.set(ask.id, pending);
    const clear = () => { if (this.inFlight.get(ask.id) === pending) this.inFlight.delete(ask.id); };
    void pending.then(clear, clear);
    return pending;
  }

  private async admitOnce(ask: PendingAsk, authority: "approval" | "standing-rule"): Promise<RemediationAdmissionResult | undefined> {
    const blocked = await this.preflight(ask);
    if (blocked) return blocked;
    if (!isRemediationAsk(ask)) return undefined;
    const freshnessReason = this.freshnessBlockReason(ask);
    const observation = this.store.snapshot().gitLabDiscussions.observations.find((entry) => entry.id === ask.intent.target && entry.askId === ask.id);
    if (freshnessReason || !observation) {
      const reason = freshnessReason ?? "the latest GitLab discussion observation is stale or no longer actionable";
      this.store.recordGitLabDiscussionAdmission(ask.intent.target, { state: "blocked", reason });
      return { state: "blocked", reason };
    }
    const suggestion = this.agentSlots.suggest(GITLAB_REMEDIATION_CAPABILITY, true);
    if (!suggestion.agent) {
      const reason = suggestion.reason ?? `no eligible agent has capability tag ${GITLAB_REMEDIATION_CAPABILITY}`;
      this.store.recordGitLabDiscussionAdmission(ask.intent.target, { state: "blocked", reason });
      return { state: "blocked", reason };
    }
    const context = ask.intent.context;
    const note = observation.discussion.notes.find((entry) => String(entry.id) === context.noteId)!;
    const task = buildTaskContext({
      workItemId: observation.workItemId,
      repository: observation.mergeRequest.repository,
      mergeRequestIid: String(observation.mergeRequest.number),
      discussionId: observation.discussion.discussionId,
      noteId: String(note.id),
      body: note.body
    });
    const stableTaskId = remediationTaskId(ask.intent.target);
    const result = await this.permissionEngine.executeTaskAdmission(ask.intent, authority, async () => this.tasks.start(
      this.manager.getActiveAgent(), task, computeSessionKey("default-operator", "default"),
      { specialistId: suggestion.agent!.id, agentId: suggestion.agent!.id },
      { taskId: stableTaskId, admissionGuard: () => this.taskAdmissionGuard(ask, suggestion.agent!.id) }
    ));
    if (result.decision.outcome !== "allowed") {
      if (authority === "standing-rule" && result.decision.outcome === "requires_approval") return undefined;
      const reason = result.decision.reason;
      this.store.recordGitLabDiscussionAdmission(ask.intent.target, { state: "blocked", reason });
      return { state: "blocked", reason };
    }
    if (result.error || !result.value) {
      const reason = result.error ?? "task execution did not admit a remediation task";
      this.store.recordGitLabDiscussionAdmission(ask.intent.target, { state: "blocked", reason });
      return { state: "blocked", reason };
    }
    this.store.recordGitLabDiscussionAdmission(ask.intent.target, { state: "admitted", taskId: result.value });
    if (authority === "standing-rule") this.store.retireAskAfterAutomaticAdmission(ask.id);
    return { state: "admitted", taskId: result.value };
  }

  private freshnessBlockReason(ask: PendingAsk): string | undefined {
    const observation = this.store.snapshot().gitLabDiscussions.observations.find((entry) => entry.id === ask.intent.target && entry.askId === ask.id);
    if (!observation || observation.status !== "observed" || observation.discussion.resolved || !hasActionableNote(observation, ask.intent.context.noteId)) {
      return observation?.discussion.resolved ? "GitLab reports that this discussion is resolved" : "the latest GitLab discussion observation is stale or no longer actionable";
    }
    return undefined;
  }

  private taskAdmissionGuard(ask: PendingAsk, agentId: string): { allowed: true } | { allowed: false; reason: string } {
    const reason = this.freshnessBlockReason(ask);
    if (reason) return { allowed: false, reason };
    const agent = this.agentSlots.list().find((entry) => entry.id === agentId && entry.status === "active" && entry.capabilityTags.includes(GITLAB_REMEDIATION_CAPABILITY));
    if (!agent) return { allowed: false, reason: `selected agent is no longer active with capability tag ${GITLAB_REMEDIATION_CAPABILITY}` };
    if (agent.full) return { allowed: false, reason: `selected agent has no free slot for capability tag ${GITLAB_REMEDIATION_CAPABILITY}` };
    return { allowed: true };
  }
}

function isRemediationAsk(ask: PendingAsk): boolean {
  return ask.kind === "gitlab.discussion.remediate" && ask.intent.tool === "gitlab" && ask.intent.operation === "discussion.remediate";
}

function hasActionableNote(observation: GitLabDiscussionObservation, noteId: string | undefined): boolean {
  if (typeof noteId !== "string") return false;
  return observation.discussion.notes.some((note) => String(note.id) === noteId && note.authorship === "human" && !note.system && note.resolvable && !note.resolved);
}

function buildTaskContext(context: { workItemId: string; repository: string; mergeRequestIid: string; discussionId: string; noteId: string; body: string }): string {
  const body = context.body.length > 4000 ? `${context.body.slice(0, 4000)}\n[discussion note truncated]` : context.body;
  return [
    `Remediate GitLab discussion ${context.discussionId} on ${context.repository}!${context.mergeRequestIid}.`,
    `Work item: ${context.workItemId}.`,
    `Required capability: ${GITLAB_REMEDIATION_CAPABILITY}.`,
    `Discussion note ${context.noteId}:`,
    body
  ].join("\n");
}

function remediationTaskId(identity: string): string {
  return `gitlab-remediation-${createHash("sha256").update(identity).digest("hex")}`;
}
