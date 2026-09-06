import type { NormalizedRuntimeEvent, RuntimeRouter } from "@aios/contracts";

/**
 * Compatibility adapter that preserves AgentAbstraction as the application
 * facade while routing all execution through the new normalized seam.
 */
export class AgentRuntimeRouter implements RuntimeRouter {
  async *run(input: Parameters<RuntimeRouter["run"]>[0]): AsyncIterable<NormalizedRuntimeEvent> {
    if (input.plan.route.runtime === "unmeasured") {
      yield {
        type: "terminal",
        outcome: {
          status: "unavailable",
          message: `UNMEASURED: ${input.plan.route.provider}/${input.plan.route.model} has no qualified runtime.`
        }
      };
      return;
    }

    let health;
    try {
      health = input.agent.checkHealth();
    } catch (error) {
      const message = error instanceof Error ? error.message : "agent health check failed";
      yield { type: "terminal", outcome: { status: "unavailable", message } };
      return;
    }

    if (!health.ok) {
      yield { type: "progress", text: health.reason };
      yield { type: "terminal", outcome: { status: "unavailable", message: health.reason } };
      return;
    }

    try {
      for await (const chunk of input.agent.runTask(input.task, input.sessionKey)) {
        yield { type: "progress", text: chunk };
      }
      yield { type: "terminal", outcome: { status: "completed" } };
    } catch (error) {
      const message = error instanceof Error ? error.message : "task failed";
      yield { type: "terminal", outcome: { status: "failed", message } };
    }
  }
}
