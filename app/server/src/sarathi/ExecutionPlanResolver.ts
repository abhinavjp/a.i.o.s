import { randomUUID } from "node:crypto";
import type { AgentAbstraction, ResolvedExecutionPlan, ResolvedRoute, RoutePolicyOverride } from "@aios/contracts";

export interface RoutePolicyConfiguration {
  getPolicy(scope: "global" | "specialist" | "workflow", id?: string): { version: string; policy: RoutePolicyOverride };
}

export interface ExecutionPlanInput {
  taskId: string;
  agent: AgentAbstraction;
  specialistId?: string;
  workflowId?: string;
  taskPolicy?: RoutePolicyOverride;
}

export interface ExecutionPlanResolver {
  resolve(input: ExecutionPlanInput): ResolvedExecutionPlan;
}

/**
 * Ticket 01's fixed policy is deliberately narrow. Later tickets replace this
 * resolver with layered configuration and eligibility logic without changing
 * the runtime-router or Fastify seams.
 */
export class DefaultExecutionPlanResolver implements ExecutionPlanResolver {
  resolve({ taskId, agent }: ExecutionPlanInput): ResolvedExecutionPlan {
    const agentInfo = agent.getInfo();
    const route: ResolvedRoute = {
      runtime: agentInfo.kind === "fake" ? "fake" : "unmeasured",
      provider: agentInfo.kind,
      model: agentInfo.id,
      billingMode: agentInfo.kind === "fake" ? "fake" : "unmeasured"
    };
    return freezePlan({
      planId: randomUUID(),
      taskId,
      route,
      fallbackRoutes: [],
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

/** Resolves fields independently: task > workflow > specialist > global. */
export class LayeredExecutionPlanResolver implements ExecutionPlanResolver {
  constructor(private readonly configuration: RoutePolicyConfiguration) {}

  resolve(input: ExecutionPlanInput): ResolvedExecutionPlan {
    const global = this.configuration.getPolicy("global");
    const specialist = this.configuration.getPolicy("specialist", input.specialistId);
    const workflow = this.configuration.getPolicy("workflow", input.workflowId);
    const taskPolicy = input.taskPolicy ?? {};
    const fallbackRoute: ResolvedRoute = {
      runtime: input.agent.getInfo().kind === "fake" ? "fake" : "unmeasured",
      provider: input.agent.getInfo().kind,
      model: input.agent.getInfo().id,
      billingMode: input.agent.getInfo().kind === "fake" ? "fake" : "unmeasured"
    };
    const policies = [global.policy, specialist.policy, workflow.policy, taskPolicy];
    const primary = lastDefined(policies.map((policy) => policy.primary)) ?? fallbackRoute;
    const fallbacks = lastDefined(policies.map((policy) => policy.fallbacks)) ?? [];
    return freezePlan({
      planId: randomUUID(),
      taskId: input.taskId,
      route: { ...primary },
      fallbackRoutes: fallbacks.map((route) => ({ ...route })),
      configurationVersions: {
        task: input.taskPolicy ? `task-inline-${randomUUID()}` : "task-inherited-v1",
        workflow: workflow.version,
        specialist: specialist.version,
        global: global.version
      },
      resolvedAt: new Date().toISOString()
    });
  }
}

export function snapshotExecutionPlan(plan: ResolvedExecutionPlan): ResolvedExecutionPlan {
  return freezePlan({
    ...plan,
    route: { ...plan.route },
    fallbackRoutes: (plan.fallbackRoutes ?? []).map((route) => ({ ...route })),
    configurationVersions: { ...plan.configurationVersions }
  });
}

function freezePlan(plan: ResolvedExecutionPlan): ResolvedExecutionPlan {
  Object.freeze(plan.route);
  for (const route of plan.fallbackRoutes ?? []) Object.freeze(route);
  Object.freeze(plan.fallbackRoutes);
  Object.freeze(plan.configurationVersions);
  return Object.freeze(plan);
}

function lastDefined<T>(values: ReadonlyArray<T | undefined>): T | undefined {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    if (values[index] !== undefined) return values[index];
  }
  return undefined;
}
