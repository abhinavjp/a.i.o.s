import { randomUUID } from "node:crypto";
import type { AgentAbstraction, ResolvedExecutionPlan, ResolvedRoute, RoutePolicyOverride, RoutePolicySnapshot } from "@aios/contracts";

export interface RoutePolicyConfiguration {
  getPolicy(scope: "global" | "specialist" | "workflow", id?: string): { version: string; policy: RoutePolicyOverride };
}

export interface ExecutionPlanInput {
  taskId: string;
  task?: string;
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
  resolve({ taskId, task, agent }: ExecutionPlanInput): ResolvedExecutionPlan {
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
      configurationSnapshots: {
        task: { version: "task-default-v1", policy: {} },
        workflow: { version: "workflow-default-v1", policy: {} },
        specialist: { version: "specialist-default-v1", policy: {} },
        global: { version: "global-default-v1", policy: {} }
      },
      resolvedAt: new Date().toISOString(),
      ...(task === undefined ? {} : { taskText: task })
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
    const taskVersion = `task-${input.taskId}-v1`;
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
        task: taskVersion,
        workflow: workflow.version,
        specialist: specialist.version,
        global: global.version
      },
      configurationSnapshots: {
        task: snapshotPolicy(taskVersion, taskPolicy),
        workflow: snapshotPolicy(workflow.version, workflow.policy),
        specialist: snapshotPolicy(specialist.version, specialist.policy),
        global: snapshotPolicy(global.version, global.policy)
      },
      resolvedAt: new Date().toISOString(),
      ...(input.task === undefined ? {} : { taskText: input.task })
    });
  }
}

export function snapshotExecutionPlan(plan: ResolvedExecutionPlan): ResolvedExecutionPlan {
  return freezePlan({
    ...plan,
    route: { ...plan.route },
    ...(plan.selection ? {
      selection: {
        ...plan.selection,
        requestedRoute: { ...plan.selection.requestedRoute },
        effectiveRoute: { ...plan.selection.effectiveRoute }
      }
    } : {}),
    fallbackRoutes: (plan.fallbackRoutes ?? []).map((route) => ({ ...route })),
    configurationVersions: { ...plan.configurationVersions },
    configurationSnapshots: snapshotConfiguration(plan.configurationSnapshots)
  });
}

function freezePlan(plan: ResolvedExecutionPlan): ResolvedExecutionPlan {
  Object.freeze(plan.route);
  if (plan.selection) {
    Object.freeze(plan.selection.requestedRoute);
    Object.freeze(plan.selection.effectiveRoute);
    Object.freeze(plan.selection);
  }
  for (const route of plan.fallbackRoutes ?? []) Object.freeze(route);
  Object.freeze(plan.fallbackRoutes);
  Object.freeze(plan.configurationVersions);
  for (const snapshot of Object.values(plan.configurationSnapshots)) {
    if (snapshot.policy.primary) Object.freeze(snapshot.policy.primary);
    if (snapshot.policy.fallbacks) {
      for (const route of snapshot.policy.fallbacks) Object.freeze(route);
      Object.freeze(snapshot.policy.fallbacks);
    }
    Object.freeze(snapshot.policy);
    Object.freeze(snapshot);
  }
  Object.freeze(plan.configurationSnapshots);
  return Object.freeze(plan);
}

function snapshotPolicy(version: string, policy: RoutePolicyOverride): RoutePolicySnapshot {
  return {
    version,
    policy: {
      ...(policy.primary ? { primary: { ...policy.primary } } : {}),
      ...(policy.fallbacks ? { fallbacks: policy.fallbacks.map((route) => ({ ...route })) } : {})
    }
  };
}

function snapshotConfiguration(
  snapshots: ResolvedExecutionPlan["configurationSnapshots"] | undefined
): ResolvedExecutionPlan["configurationSnapshots"] {
  const source = snapshots ?? {
    task: { version: "task-legacy-v1", policy: {} },
    workflow: { version: "workflow-legacy-v1", policy: {} },
    specialist: { version: "specialist-legacy-v1", policy: {} },
    global: { version: "global-legacy-v1", policy: {} }
  };
  return {
    task: snapshotPolicy(source.task.version, source.task.policy),
    workflow: snapshotPolicy(source.workflow.version, source.workflow.policy),
    specialist: snapshotPolicy(source.specialist.version, source.specialist.policy),
    global: snapshotPolicy(source.global.version, source.global.policy)
  };
}

function lastDefined<T>(values: ReadonlyArray<T | undefined>): T | undefined {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    if (values[index] !== undefined) return values[index];
  }
  return undefined;
}
