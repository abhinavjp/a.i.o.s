import { createHash } from "node:crypto";

export function computeSessionKey(operatorId: string, projectId: string): string {
  return createHash("sha256").update(`${operatorId}:${projectId}`).digest("hex");
}
