import type { SarathiToolExecutor, ToolDefinition } from "@aios/contracts";

export const DELIVERY_PIPELINE_TOOL: ToolDefinition = {
  tool: "delivery-pipeline",
  operations: ["artifact.approve", "phase.accept", "track.change", "worksource.transition"]
};

export function withDeliveryPipelineTools(tools: SarathiToolExecutor): SarathiToolExecutor {
  return { ...tools, definitions: [...tools.definitions, DELIVERY_PIPELINE_TOOL] };
}
