import { randomUUID } from "node:crypto";
import type { AgentAbstraction, ResolvedExecutionPlan, ResolvedRoute } from "@aios/contracts";

export interface ExecutionPlanResolver {
  resolve(input: { taskId: string; agent: AgentAbstraction }): ResolvedExecutionPlan;
}

/**
 * Ticket 01's fixed policy is deliberately narrow. Later tickets replace this
 * resolver with layered configuration and eligibility logic without changing
 * the runtime-router or Fastify seams.
 */
export class DefaultExecutionPlanResolver implements ExecutionPlanResolver {
  resolve({ taskId, agent }: { taskId: string; agent: AgentAbstraction }): ResolvedExecutionPlan {
    const agentInfo = agent.getInfo();
    const route: ResolvedRoute = {
      runtime: "agent-abstraction",
      provider: agentInfo.kind,
      model: agentInfo.id,
      billingMode: "fake"
    };
    return freezePlan({
      planId: randomUUID(),
      taskId,
      route,
      configurationVersions: {
        task: "task-default-v1",
        workflow: "workflow-default-v1",
        specialist: "specialist-default-v1",
        global: "global-default-v1"
      },
      resolvedAt: new Date().toISOString()
    });
  }
}

function freezePlan(plan: ResolvedExecutionPlan): ResolvedExecutionPlan {
  Object.freeze(plan.route);
  Object.freeze(plan.configurationVersions);
  return Object.freeze(plan);
}
