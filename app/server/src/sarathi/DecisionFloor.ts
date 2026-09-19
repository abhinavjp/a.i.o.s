import type { PermissionRule, ToolIntent } from "@aios/contracts";

const ADHISTHANA_BRANCH = "adhisthana/";

/** These records are durable evidence of the actions that require a human decision. */
export const FLOOR_RULES: ReadonlyArray<PermissionRule> = [
  floorRule("shared-repository-push", "code-host", "push", "shared-repository"),
  floorRule("work-source-transition", "delivery-pipeline", "worksource.transition", "work-source-ticket"),
  floorRule("apply-update", "system-update", "apply", "installation"),
  floorRule("irreversible-outside-adhisthana", "repository", "irreversible", "outside-adhisthana-branch")
];

export function isFloorRule(rule: PermissionRule): boolean { return FLOOR_RULES.some((floor) => floor.id === rule.id); }

export function isFloorIntent(intent: ToolIntent): boolean {
  if (intent.tool === "delivery-pipeline" && intent.operation === "worksource.transition") return true;
  if ((intent.tool === "work-source" || intent.tool === "worksource") && /^(transition|close)$/.test(intent.operation)) return true;
  if (intent.tool === "system-update" && /^(apply|update.apply)$/.test(intent.operation)) return true;
  const branch = intent.context.branch ?? intent.target;
  if ((intent.tool === "code-host" || intent.tool === "repository") && intent.operation === "push") return !branch.toLowerCase().startsWith(ADHISTHANA_BRANCH);
  return /^(merge|delete|publish|irreversible)$/.test(intent.operation) && !branch.toLowerCase().startsWith(ADHISTHANA_BRANCH);
}

export function wouldAllowFloorAction(rule: Omit<PermissionRule, "id" | "remainingUses" | "createdAt">): boolean {
  if (rule.decision !== "allow") return false;
  return isFloorIntent({ tool: rule.tool, operation: rule.operation, target: rule.target, context: rule.context });
}

function floorRule(id: string, tool: string, operation: string, target: string): PermissionRule {
  return { id: `floor:${id}`, decision: "ask", tool, operation, target, lifetime: "global", context: {}, remainingUses: null, createdAt: "permanent" };
}
