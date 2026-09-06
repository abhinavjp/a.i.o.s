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
  ToolIntent
} from "@aios/contracts";
import type { SarathiStore } from "./SarathiStore.js";

export class PermissionEngine {
  constructor(
    private readonly store: SarathiStore,
    private readonly tools: SarathiToolExecutor,
    private readonly classifier?: PermissionSemanticClassifier
  ) {}

  async execute(intent: ToolIntent): Promise<ToolExecutionResult> {
    if (!this.isDefined(intent)) {
      return { decision: { outcome: "denied", reason: "Sarathi has not defined this tool operation" } };
    }

    const decision = await this.evaluate(intent);
    if (decision.outcome !== "allowed") {
      return { decision };
    }
    const result = await this.tools.execute(intent);
    return { decision, output: result.output };
  }

  saveRule(input: Omit<PermissionRule, "id" | "remainingUses" | "createdAt">): PermissionRule {
    return this.store.addPermissionRule({
      ...input,
      id: randomUUID(),
      remainingUses: input.lifetime === "once" ? 1 : null,
      createdAt: new Date().toISOString()
    });
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

  private async evaluate(intent: ToolIntent): Promise<PermissionDecision> {
    const rules = this.store.snapshot().permissions.rules.filter((rule) => matchesRule(rule, intent));
    if (rules.some((rule) => rule.decision === "deny")) {
      return { outcome: "denied", reason: "hard deny" };
    }

    const ask = rules.some((rule) => rule.decision === "ask");
    const approval = this.store.findMatchingApproval(intent);
    if (ask) {
      return approval ? this.useApproval(approval, "action-bound approval") : { outcome: "requires_approval", reason: "scoped ask" };
    }
    if (rules.some((rule) => rule.decision === "allow")) {
      return { outcome: "allowed", reason: "scoped allow" };
    }
    if (isDeterministicallySafe(intent)) {
      return { outcome: "allowed", reason: "deterministic safe/read-only" };
    }
    if (!isConsequential(intent) && this.classifier) {
      try {
        if (await this.classifier.classify(intent) === "low-risk") {
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

  private isDefined(intent: ToolIntent): boolean {
    return this.tools.definitions.some((definition) =>
      definition.tool === intent.tool && definition.operations.includes(intent.operation)
    );
  }
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

function matchesRule(rule: PermissionRule, intent: ToolIntent): boolean {
  if (rule.remainingUses === 0 || rule.tool !== intent.tool || rule.operation !== intent.operation || rule.target !== intent.target) return false;
  return Object.entries(rule.context).every(([key, value]) => intent.context[key] === value);
}

function isDeterministicallySafe(intent: ToolIntent): boolean {
  return /^(get|list|read|search|inspect|status)(_|$)/.test(intent.operation);
}

function isConsequential(intent: ToolIntent): boolean {
  return /(write|delete|remove|send|message|merge|deploy|credential|secret|publish|create|update|modify|execute|run)/.test(intent.operation) ||
    /(message|email|deploy|credential|secret)/.test(intent.tool);
}
