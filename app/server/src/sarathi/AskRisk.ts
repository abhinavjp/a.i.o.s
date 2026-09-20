export type AskRisk = "low" | "medium" | "high";

export function riskOf(kind: string): AskRisk {
  if (kind.includes("recovery")) return "high";
  if (kind === "track.change" || kind === "phase.accept" || kind.includes("review")) return "medium";
  if (kind === "question" || kind.includes("approve") || kind.includes("approval")) return "low";
  return "high";
}
