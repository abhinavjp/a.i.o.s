import { randomUUID } from "node:crypto";
import type {
  ActionBoundApproval,
  ApprovalLifetime,
  PermissionDecision,
  PermissionRule,
  PermissionRuleDecision,
  PermissionSemanticClassifier,
  SarathiToolExecutor,
  ToolExecutionResult,
  ToolExecutionContext,
  ToolIntent
} from "@aios/contracts";
import { matchesPermissionRule, type AutomaticDecision, type PendingAsk, type SarathiStore } from "./SarathiStore.js";
import { isFloorAskKind, isFloorIntent, wouldAllowFloorAction } from "./DecisionFloor.js";
import { riskOf } from "./AskRisk.js";

type EngineDecision = PermissionDecision & { automatic?: Pick<AutomaticDecision, "source" | "sourceDetail"> };

export class PermissionEngine {
  constructor(
    private readonly store: SarathiStore,
    private readonly tools: SarathiToolExecutor,
    private readonly classifier?: PermissionSemanticClassifier
  ) {}

  async execute(intent: ToolIntent, context?: ToolExecutionContext): Promise<ToolExecutionResult> {
    if (!this.isDefined(intent)) {
      const decision = { outcome: "denied" as const, reason: "Sarathi has not defined this tool operation" };
      context?.onDecision(decision);
      return { decision };
    }

    context?.signal.throwIfAborted();
    const decision = await this.evaluate(intent, context?.signal);
    context?.onDecision(decision);
    if (decision.outcome === "requires_approval") {
      this.store.addPendingAsk({ kind: intent.operation, workItemId: intent.context.workItemId ?? null, intent });
    }
    if (decision.outcome !== "allowed") {
      return { decision };
    }
    context?.signal.throwIfAborted();
    const definition = this.tools.definitions.find((entry) => entry.tool === intent.tool)!;
    context?.beforeExecute(definition.idempotent ?? (isDeterministicallySafe(intent) && !isConsequential(intent)));
    try {
      const result = await this.tools.execute(intent, context ? { idempotencyKey: context.idempotencyKey, signal: context.signal } : undefined);
      if (decision.automatic) this.store.addAutomaticDecision({ intent, ...decision.automatic, workItemId: intent.context.workItemId ?? null, undoable: this.canUndo(intent) });
      return { decision, output: result.output, effect: "completed" };
    } catch (error) {
      return { decision, effect: "uncertain", error: error instanceof Error ? error.message : "tool execution interrupted" };
    }
  }

  saveRule(input: Omit<PermissionRule, "id" | "remainingUses" | "createdAt">): PermissionRule {
    return this.store.addPermissionRule(this.buildRule(input));
  }

  /** Applies the canonical permission decision to a bounded remediation task admission. */
  async executeTaskAdmission<T>(intent: ToolIntent, admission: "approval" | "standing-rule", admit: () => Promise<T>): Promise<{ decision: PermissionDecision; value?: T; error?: string }> {
    if (intent.tool !== "gitlab" || intent.operation !== "discussion.remediate") {
      return { decision: { outcome: "denied", reason: "this intent is not a remediation task admission" } };
    }
    const decision = await this.evaluate(intent, undefined, admission);
    if (decision.outcome !== "allowed") return { decision };
    try {
      const value = await admit();
      if (decision.automatic) this.store.addAutomaticDecision({ intent, ...decision.automatic, workItemId: intent.context.workItemId ?? null, undoable: false });
      return { decision, value };
    } catch (error) {
      return { decision, error: error instanceof Error ? error.message : "remediation task admission failed" };
    }
  }

  /** A standing rule is an allow rule for one ask kind; the floor refuses to be covered. */
  buildStandingRule(askKind: string, scope: string | "all"): PermissionRule {
    if (isFloorAskKind(askKind)) throw new Error("floor actions cannot be covered by a standing rule");
    const operation = askKind === "gitlab.discussion.remediate" ? "discussion.remediate" : askKind;
    return this.buildRule({ decision: "allow", tool: "*", operation, target: "*", lifetime: "global", context: scope === "all" ? {} : { repository: scope } });
  }

  /** Validates a rule against the floor and returns it without storing it. */
  buildRule(input: Omit<PermissionRule, "id" | "remainingUses" | "createdAt">): PermissionRule {
    if (wouldAllowFloorAction(input)) throw new Error("floor actions cannot be allowed by a rule");
    return {
      ...input,
      id: randomUUID(),
      remainingUses: input.lifetime === "once" ? 1 : null,
      createdAt: new Date().toISOString()
    };
  }

  approve(intent: ToolIntent, lifetime: ApprovalLifetime): ActionBoundApproval {
    return this.store.addApproval({
      id: randomUUID(),
      intent,
      lifetime,
      remainingUses: lifetime === "once" ? 1 : null,
      createdAt: new Date().toISOString()
    });
  }

  async undoAutomaticDecision(id: string): Promise<{ decision: AutomaticDecision; ask: PendingAsk } | "not-found" | "not-undoable"> {
    const decision = this.store.getAutomaticDecision(id);
    if (!decision || decision.undone) return "not-found";
    if (!decision.undoable || !this.tools.undo) return "not-undoable";
    await this.tools.undo(decision.intent);
    return this.store.undoAutomaticDecision(id) ?? "not-found";
  }

  private async evaluate(intent: ToolIntent, signal?: AbortSignal, taskAdmission?: "approval" | "standing-rule"): Promise<EngineDecision> {
    if (isFloorIntent(intent)) {
      const approval = this.store.findMatchingApproval(intent);
      return approval ? this.useApproval(approval, "floor approval") : { outcome: "requires_approval", reason: "floor action requires operator approval" };
    }
    const rules = this.store.snapshot().permissions.rules.filter((rule) => matchesPermissionRule(rule, intent));
    if (rules.some((rule) => rule.decision === "deny")) {
      return { outcome: "denied", reason: "hard deny" };
    }

    const ask = rules.some((rule) => rule.decision === "ask");
    const approval = this.store.findMatchingApproval(intent);
    if (taskAdmission === "standing-rule" && ask) {
      return { outcome: "requires_approval", reason: "scoped ask" };
    }
    if (ask) {
      return approval ? this.useApproval(approval, "action-bound approval") : { outcome: "requires_approval", reason: "scoped ask" };
    }
    if (taskAdmission === "approval") {
      return approval ? this.useApproval(approval, "action-bound approval") : { outcome: "requires_approval", reason: "remediation admission requires operator approval" };
    }
    if (taskAdmission === "standing-rule") {
      const standingRule = this.store.matchAndConsumeStandingRule(intent);
      if (standingRule) {
        return { outcome: "allowed", reason: "standing rule", automatic: { source: "standing rule", sourceDetail: standingRule.label } };
      }
      return { outcome: "requires_approval", reason: "remediation admission requires a standing rule" };
    }
    // Floor intents returned above, so a standing rule can never settle one.
    const standingRule = this.canUndo(intent) ? this.store.matchAndConsumeStandingRule(intent) : undefined;
    if (standingRule) {
      return { outcome: "allowed", reason: "standing rule", automatic: { source: "standing rule", sourceDetail: standingRule.label } };
    }
    if (this.canUndo(intent) && this.store.matchesAutopilot(intent.operation)) {
      return { outcome: "allowed", reason: "autopilot", automatic: { source: "autopilot", sourceDetail: riskOf(intent.operation) } };
    }
    if (isConsequential(intent)) {
      return approval ? this.useApproval(approval, "action-bound approval") : { outcome: "requires_approval", reason: "operator approval required" };
    }
    if (this.store.matchAndConsumePermissionRule(intent, "allow")) {
      return { outcome: "allowed", reason: "scoped allow" };
    }
    if (isDeterministicallySafe(intent)) {
      return { outcome: "allowed", reason: "deterministic safe/read-only" };
    }
    if (this.classifier) {
      try {
        const classification = this.classifier.classify(intent);
        const result = signal ? await Promise.race([classification, abortOn(signal)]) : await classification;
        if (result === "low-risk") {
          return { outcome: "allowed", reason: "semantic low-risk" };
        }
      } catch {
        // Classifier availability is never permission evidence.
      }
    }
    return approval ? this.useApproval(approval, "action-bound approval") : { outcome: "requires_approval", reason: "operator approval required" };
  }

  private useApproval(approval: ActionBoundApproval, reason: string): PermissionDecision {
    if (approval.remainingUses !== null) {
      this.store.consumeApproval(approval.id);
    }
    return { outcome: "allowed", reason };
  }

  private canUndo(intent: ToolIntent): boolean {
    return this.tools.isUndoable?.(intent) === true && typeof this.tools.undo === "function";
  }

  private isDefined(intent: ToolIntent): boolean {
    return this.tools.definitions.some((definition) =>
      definition.tool === intent.tool && definition.operations.includes(intent.operation)
    );
  }
}

function abortOn(signal: AbortSignal): Promise<never> {
  if (signal.aborted) return Promise.reject(new Error("permission evaluation cancelled"));
  return new Promise((_, reject) => {
    signal.addEventListener("abort", () => reject(new Error("permission evaluation cancelled")), { once: true });
  });
}

export function isPermissionRuleDecision(value: unknown): value is PermissionRuleDecision {
  return value === "deny" || value === "ask" || value === "allow";
}

export function isApprovalLifetime(value: unknown): value is ApprovalLifetime {
  return value === "once" || value === "session" || value === "project" || value === "global";
}

export function isToolIntent(value: unknown): value is ToolIntent {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return ["tool", "operation", "target"].every((key) => typeof candidate[key] === "string" && candidate[key].trim()) &&
    Boolean(candidate.context) && typeof candidate.context === "object" && !Array.isArray(candidate.context) &&
    Object.values(candidate.context as Record<string, unknown>).every((entry) => typeof entry === "string");
}

function isDeterministicallySafe(intent: ToolIntent): boolean {
  return /^(get|list|read|search|inspect|status)(_|$)/.test(intent.operation);
}

function isConsequential(intent: ToolIntent): boolean {
  return /(write|delete|remove|send|message|merge|deploy|credential|secret|publish|create|update|modify|execute|run)/.test(intent.operation) ||
    /(message|email|deploy|credential|secret)/.test(intent.tool);
}
