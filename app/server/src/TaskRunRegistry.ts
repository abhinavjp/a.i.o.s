import { createHash, randomUUID } from "node:crypto";
import type { AgentAbstraction, ResolvedExecutionPlan, RoutePolicyOverride, RuntimeAttempt, RuntimeRouter, TaskOutcome, ToolExecutionContext, ToolExecutionResult, ToolIntent } from "@aios/contracts";
import { AgentRuntimeRouter } from "./sarathi/AgentRuntimeRouter.js";
import { DefaultExecutionPlanResolver, snapshotExecutionPlan, type ExecutionPlanResolver } from "./sarathi/ExecutionPlanResolver.js";
import { needsReconciliation, type StoredTask, type TaskStore } from "./TaskStore.js";
import { IneligibleRouteError, type ExecutionPlanAdmissionValidator, type FixedRouteSelector } from "./sarathi/RouteEligibility.js";
import { systemRuntimeClock, type RouteResilience } from "./sarathi/RouteResilience.js";

interface TaskListener { onChunk: (chunk: string) => void; onDone: (outcome: TaskOutcome) => void }
export interface TaskExecutionObserver { record(task: StoredTask): void }
export interface TaskToolMediator { execute(intent: ToolIntent, context?: ToolExecutionContext): Promise<ToolExecutionResult> }
type Execution = { taskId: string; task: string; sessionKey: string; plan: ResolvedExecutionPlan; agent: AgentAbstraction; signal: AbortSignal };

/** Sarathi owns durable boundaries, tool authority, retries and cancellation. */
export class TaskRunRegistry {
  private readonly listeners = new Map<string, TaskListener>();
  private readonly active = new Map<string, { controller: AbortController; completion: Promise<void> }>();

  constructor(
    private readonly store: TaskStore,
    private readonly runtimeRouter: RuntimeRouter = new AgentRuntimeRouter(),
    private readonly planResolver: ExecutionPlanResolver = new DefaultExecutionPlanResolver(),
    private readonly observer?: TaskExecutionObserver,
    private readonly planAdmissionValidator?: ExecutionPlanAdmissionValidator,
    private readonly fixedRouteSelector?: FixedRouteSelector,
    private readonly toolMediator?: TaskToolMediator,
    private readonly resilience?: RouteResilience
  ) {}

  start(agent: AgentAbstraction, task: string, sessionKey: string,
    routing: { specialistId?: string; workflowId?: string; taskPolicy?: RoutePolicyOverride } = {}): string {
    const taskId = randomUUID();
    const now = new Date(this.clock.now()).toISOString();
    const resolved = this.planResolver.resolve({ taskId, task, agent, ...routing });
    const plan = snapshotExecutionPlan(this.fixedRouteSelector?.select(resolved) ?? resolved);
    this.planAdmissionValidator?.validate(plan);
    this.assertSelectedAgentHealthy(agent, plan);
    this.store.create({ taskId, task, sessionKey, chunks: [], status: "running", outcome: null,
      createdAt: now, updatedAt: now, resolvedExecutionPlan: plan, attempts: [this.attempt(plan)] });
    this.notify(taskId);
    const controller = new AbortController();
    const execution = { controller, completion: Promise.resolve() };
    this.active.set(taskId, execution);
    execution.completion = this.execute({ taskId, task, sessionKey, plan, agent, signal: controller.signal })
      .catch((error) => this.finish(taskId, controller.signal.aborted ? cancelledOutcome() : { status: "failed", message: errorMessage(error) }))
      .finally(() => this.active.delete(taskId));
    return taskId;
  }

  has(taskId: string): boolean { return this.store.get(taskId) !== undefined; }
  get(taskId: string) { return this.store.get(taskId); }

  async cancel(taskId: string): Promise<StoredTask | undefined> {
    const task = this.store.get(taskId);
    if (!task || task.outcome) return task;
    const execution = this.active.get(taskId);
    if (execution) {
      if (!execution.controller.signal.aborted) {
        this.store.appendHistory(taskId, { type: "cancellation-requested" });
        execution.controller.abort();
      }
      await execution.completion;
    }
    return this.store.get(taskId);
  }

  async close(): Promise<void> { await Promise.all([...this.active.keys()].map((id) => this.cancel(id))); }

  attach(taskId: string, onChunk: (chunk: string) => void, onDone: (outcome: TaskOutcome) => void): boolean {
    const task = this.store.get(taskId);
    if (!task) return false;
    for (const chunk of task.chunks) onChunk(chunk);
    if (task.outcome) onDone(task.outcome);
    else this.listeners.set(taskId, { onChunk, onDone });
    return true;
  }

  private get clock() { return this.resilience?.clock ?? systemRuntimeClock; }

  private async execute(input: Execution): Promise<void> {
    const routes = [input.plan.route, ...input.plan.fallbackRoutes];
    let plan = input.plan;
    for (let routeIndex = 0; routeIndex < routes.length; routeIndex++) {
      for (let retry = 0; retry <= 2; retry++) {
        input.signal.throwIfAborted();
        if (routeIndex > 0 || retry > 0) {
          // Every continuation is rechecked; admission never grants future health.
          this.resilience?.assertAvailable(plan.route);
          this.store.startAttempt(input.taskId, this.attempt(plan));
        }
        this.notify(input.taskId);
        let outcome = await this.runAttempt({ ...input, plan });
        if (input.signal.aborted || outcome.status === "cancelled") outcome = cancelledOutcome();
        else if (needsReconciliation(this.store.get(input.taskId)!)) outcome = { status: "blocked", message: "Uncertain non-idempotent effect requires reconciliation" };
        this.store.applyRuntimeEvent(input.taskId, { type: "terminal", outcome }, false);
        if (outcome.status === "cancelled" || outcome.status === "blocked") { this.finish(input.taskId, outcome); return; }
        if (outcome.status === "completed") {
          this.resilience?.success(plan.route);
          this.finish(input.taskId, outcome);
          return;
        }
        this.resilience?.failure(plan.route, outcome.failure);
        this.notify(input.taskId);
        if (outcome.failure?.kind !== "transient") { this.finish(input.taskId, outcome); return; }
        if (retry < 2) {
          const delayMs = Math.round(100 * 2 ** retry * (1 + this.clock.random() * 0.5));
          this.store.appendHistory(input.taskId, { type: "retry", retryNumber: retry + 1, delayMs });
          this.notify(input.taskId);
          await this.clock.sleep(delayMs, input.signal);
          continue;
        }
        const nextRoute = routes[routeIndex + 1];
        if (!nextRoute) { this.finish(input.taskId, outcome); return; }
        const nextPlan = snapshotExecutionPlan({ ...input.plan, route: nextRoute, fallbackRoutes: [] });
        this.planAdmissionValidator?.validate(nextPlan);
        plan = snapshotExecutionPlan(this.fixedRouteSelector?.select(nextPlan) ?? nextPlan);
        this.store.appendHistory(input.taskId, { type: "fallback", from: routes[routeIndex]!, to: nextRoute,
          reason: "Same-route transient retries exhausted at a durable attempt boundary" });
      }
    }
  }

  private async runAttempt(input: Execution): Promise<TaskOutcome> {
    const attempt = this.store.get(input.taskId)!.attempts!.at(-1)!;
    const tools = new Map<string, Promise<ToolExecutionResult>>();
    const invocationCounts = new Map<string, number>();
    const controller = new AbortController();
    const abort = () => controller.abort();
    input.signal.addEventListener("abort", abort, { once: true });
    if (input.signal.aborted) abort();
    let outcome: TaskOutcome = { status: "failed", message: "runtime ended without a terminal outcome" };
    try {
      for await (const event of this.runtimeRouter.run({ ...input, signal: controller.signal, attemptId: attempt.attemptId,
        canonicalHistory: this.store.get(input.taskId)!.canonicalHistory ?? [], retryPolicy: { maxRetries: 0 },
        executeTool: (intent) => {
          controller.signal.throwIfAborted();
          const fingerprint = toolFingerprint(intent);
          const occurrence = (invocationCounts.get(fingerprint) ?? 0) + 1;
          invocationCounts.set(fingerprint, occurrence);
          const key = toolKey(input.taskId, intent, occurrence);
          if (!tools.has(key)) tools.set(key, this.executeTool(input.taskId, intent, key, controller.signal));
          return tools.get(key)!;
        }
      })) {
        if (input.signal.aborted) { outcome = cancelledOutcome(); break; }
        if (event.type === "terminal") { outcome = event.outcome; break; }
        this.store.applyRuntimeEvent(input.taskId, event);
        if (event.type === "progress") this.listeners.get(input.taskId)?.onChunk(event.text);
        this.notify(input.taskId);
      }
    } catch (error) {
      outcome = input.signal.aborted ? cancelledOutcome() : { status: "failed", message: errorMessage(error) };
    } finally {
      controller.abort();
      await Promise.allSettled(tools.values());
      input.signal.removeEventListener("abort", abort);
    }
    return outcome;
  }

  private async executeTool(taskId: string, intent: ToolIntent, idempotencyKey: string, signal: AbortSignal): Promise<ToolExecutionResult> {
    signal.throwIfAborted();
    // A runtime must not mutate an action while permission classification awaits.
    intent = Object.freeze({ tool: intent.tool, operation: intent.operation, target: intent.target,
      context: Object.freeze({ ...intent.context }) });
    const history = this.store.get(taskId)!.canonicalHistory ?? [];
    const prior = [...history].reverse().find((event) => event.type === "tool-result" && event.idempotencyKey === idempotencyKey && event.result.effect === "completed");
    if (prior?.type === "tool-result") return prior.result;
    if (needsReconciliation(this.store.get(taskId)!)) throw new Error("Uncertain non-idempotent effect requires reconciliation");
    this.store.appendHistory(taskId, { type: "tool-intent", idempotencyKey, intent });
    const context: ToolExecutionContext = {
      idempotencyKey, signal,
      onDecision: (decision) => this.store.appendHistory(taskId, { type: "permission-decision", idempotencyKey, decision }),
      beforeExecute: (idempotent) => { signal.throwIfAborted(); this.store.appendHistory(taskId, { type: "tool-started", idempotencyKey, idempotent }); }
    };
    let result: ToolExecutionResult;
    if (this.toolMediator) result = await this.toolMediator.execute(intent, context);
    else {
      result = { decision: { outcome: "denied", reason: "Sarathi has no tool authority configured" } };
      context.onDecision(result.decision);
    }
    this.store.appendHistory(taskId, { type: "tool-result", idempotencyKey, result });
    this.notify(taskId);
    return result;
  }

  private attempt(plan: ResolvedExecutionPlan): RuntimeAttempt {
    return { attemptId: randomUUID(), route: plan.route, selection: plan.selection, status: "running", outcome: null,
      startedAt: new Date(this.clock.now()).toISOString(), completedAt: null, events: [] };
  }

  private finish(taskId: string, outcome: TaskOutcome): void {
    const task = this.store.get(taskId);
    if (!task || task.outcome) return;
    if (!task.attempts?.at(-1)?.outcome) this.store.applyRuntimeEvent(taskId, { type: "terminal", outcome }, false);
    this.store.completeTask(taskId, outcome);
    this.notify(taskId);
    const listener = this.listeners.get(taskId);
    if (listener) { this.listeners.delete(taskId); listener.onDone(outcome); }
  }

  private notify(taskId: string): void {
    const task = this.store.get(taskId);
    if (task) this.observer?.record(task);
  }

  private assertSelectedAgentHealthy(agent: AgentAbstraction, plan: ResolvedExecutionPlan): void {
    if (!plan.selection || plan.selection.authenticationMode === "fake" || (plan.route.runtime === "unmeasured" && plan.route.billingMode === "unmeasured")) return;
    try {
      const health = agent.checkHealth();
      if (!health.ok) throw new IneligibleRouteError(health.reason);
    } catch (error) {
      if (error instanceof IneligibleRouteError) throw error;
      throw new IneligibleRouteError(errorMessage(error));
    }
  }
}

function cancelledOutcome(): TaskOutcome { return { status: "cancelled", message: "Stopped by operator; partial output retained" }; }
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : "runtime execution failed"; }
function toolFingerprint(intent: ToolIntent): string {
  return JSON.stringify([intent.tool, intent.operation, intent.target, Object.entries(intent.context).sort(([a], [b]) => a.localeCompare(b))]);
}
function toolKey(taskId: string, intent: ToolIntent, occurrence: number): string {
  const canonical = `${toolFingerprint(intent)}:${occurrence}`;
  return `sarathi:${taskId}:${createHash("sha256").update(canonical).digest("hex")}`;
}
