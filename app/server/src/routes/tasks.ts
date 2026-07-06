import type { FastifyInstance } from "fastify";
import type { AgentManager } from "@aios/agents";
import { TaskRunRegistry } from "../TaskRunRegistry.js";
import { computeSessionKey } from "../sessionKey.js";

interface SubmitTaskBody {
  task: string;
}

interface StreamParams {
  taskId: string;
}

export function registerTaskRoutes(app: FastifyInstance, manager: AgentManager): void {
  const registry = new TaskRunRegistry();

  app.post<{ Body: SubmitTaskBody }>("/api/agents/active/tasks", async (request, reply) => {
    const { task } = request.body;
    const agent = manager.getActiveAgent();
    const sessionKey = computeSessionKey("default-operator", "default");

    const taskId = registry.start(agent, task, sessionKey);

    reply.code(202);
    return { taskId };
  });

  app.get<{ Params: StreamParams }>(
    "/api/agents/active/tasks/:taskId/stream",
    async (request, reply) => {
      const { taskId } = request.params;

      if (!registry.has(taskId)) {
        reply.code(404);
        return { error: "Task not found" };
      }

      return new Promise<void>((resolve) => {
        reply.raw.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive"
        });

        registry.attach(
          taskId,
          (chunk) => {
            reply.raw.write(`data: ${chunk}\n\n`);
          },
          () => {
            reply.raw.write("event: done\ndata: \n\n");
            reply.raw.end();
            resolve();
          }
        );
      });
    }
  );
}
