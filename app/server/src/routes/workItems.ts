import type { FastifyInstance } from "fastify";
import type { WorkItemStore } from "../WorkItemStore.js";
import type { StageKind, StageState, TaskStatus } from "@aios/contracts";
import type { CodeHost, WorkSource } from "@aios/connectors";
import type { ArtifactStore } from "../ArtifactStore.js";
import type { PhaseStore } from "../PhaseStore.js";
import type { TaskStore } from "../TaskStore.js";

interface CreateWorkItemBody { title?: unknown; repositories?: unknown; }
interface ApproveTrackBody { startingPoint?: unknown; }
interface SetStageStateBody { state?: unknown; }
interface AddPhaseTaskBody { taskId?: unknown; }

const STARTING_POINTS: Record<string, StageKind[]> = {
  full: ["functional-analysis", "technical-analysis", "spec-and-eval", "plan", "implementation", "final-review", "merge"],
  standard: ["technical-analysis", "spec-and-eval", "plan", "implementation", "final-review", "merge"],
  fast: ["plan", "implementation", "merge"],
  "analysis-only": ["functional-analysis", "technical-analysis"]
};
const STAGE_STATES: StageState[] = ["not-started", "running", "waiting", "blocked", "done", "skipped"];

export function registerWorkItemRoutes(app: FastifyInstance, store: WorkItemStore, workSource: WorkSource | undefined, codeHost: CodeHost | undefined, artifactStore: ArtifactStore | undefined, phaseStore: PhaseStore, taskStore: TaskStore): void {
  app.get("/api/work-items", async () => ({ workItems: store.list() }));
  app.post("/api/work-items/import", async () => {
    const tickets = await workSource?.listAssignedTickets() ?? [];
    const imported = tickets.map((ticket) => store.import({ workSourceKey: ticket.key, title: ticket.title })).filter(Boolean);
    return { imported: imported.length, skipped: tickets.length - imported.length, workItems: store.list() };
  });
  app.get<{ Params: { workItemId: string } }>("/api/work-items/:workItemId/merge-requests", async (request, reply) => {
    const workItem = store.list().find((candidate) => candidate.id === request.params.workItemId);
    if (!workItem) { reply.code(404); return { error: "work item was not found" }; }
    return { mergeRequests: await codeHost?.listMergeRequests(workItem.id) ?? [] };
  });
  app.get<{ Params: { artifactId: string } }>("/api/artifacts/:artifactId/content", async (request, reply) => {
    const artifact = artifactStore?.get(request.params.artifactId);
    if (!artifact) { reply.code(404); return { available: false }; }
    if (artifact.kind === "derived") {
      if (artifact.codeHostView === "phase-diff") return codeHost?.readDiffSummary(artifact.workItemId) ?? { available: false };
      const mergeRequests = await codeHost?.listMergeRequests(artifact.workItemId) ?? [];
      return { available: mergeRequests.length > 0, mergeRequests };
    }
    return codeHost?.readFile(artifact.branch, artifact.filePath) ?? { available: false, content: null };
  });
  app.get<{ Params: { workItemId: string } }>("/api/work-items/:workItemId/artifacts", async (request) => ({ artifacts: artifactStore?.list(request.params.workItemId) ?? [] }));
  app.get<{ Params: { workItemId: string } }>("/api/work-items/:workItemId/phases", async (request) => ({ phases: phaseStore.list(request.params.workItemId).map((stored) => ({ ...stored, tasks: stored.phase.taskIds.map((taskId) => {
    const task = taskStore.get(taskId);
    return task ? { taskId: task.taskId, name: task.task, agent: task.resolvedExecutionPlan?.route.runtime ?? task.executedEngineRoute?.engine ?? "unknown", status: task.status } : null;
  }).filter((task): task is { taskId: string; name: string; agent: string; status: TaskStatus } => task !== null) })) }));
  app.post<{ Params: { workItemId: string; phaseNumber: string }; Body: AddPhaseTaskBody }>("/api/work-items/:workItemId/phases/:phaseNumber/tasks", async (request, reply) => {
    const { taskId } = request.body ?? {};
    const phaseNumber = Number(request.params.phaseNumber);
    if (typeof taskId !== "string" || !taskId.trim()) { reply.code(400); return { error: "taskId is required" }; }
    if (!Number.isInteger(phaseNumber)) { reply.code(400); return { error: "phase number must be an integer" }; }
    if (!taskStore.get(taskId)) { reply.code(400); return { error: `task was not found: ${taskId}` }; }
    try { phaseStore.addTask(request.params.workItemId, phaseNumber, taskId); return { phases: phaseStore.list(request.params.workItemId) }; }
    catch (error) { reply.code(400); return { error: error instanceof Error ? error.message : "task could not be added to phase" }; }
  });
  app.post<{ Body: CreateWorkItemBody }>("/api/work-items", async (request, reply) => {
    const { title, repositories } = request.body ?? {};
    if (typeof title !== "string" || !title.trim()) { reply.code(400); return { error: "title is required" }; }
    if (!Array.isArray(repositories) || repositories.some((repository) => typeof repository !== "string" || !repository.trim())) {
      reply.code(400); return { error: "repositories must be a list of names" };
    }
    const workItem = store.create({ title, repositories: repositories.map((repository) => repository.trim()) });
    reply.code(201);
    return { workItem };
  });
  app.post<{ Params: { workItemId: string }; Body: ApproveTrackBody }>("/api/work-items/:workItemId/track", async (request, reply) => {
    const startingPoint = request.body?.startingPoint;
    if (typeof startingPoint !== "string" || !STARTING_POINTS[startingPoint]) {
      reply.code(400); return { error: "startingPoint must be full, standard, fast, or analysis-only" };
    }
    try {
      return { workItem: store.approveTrack(request.params.workItemId, STARTING_POINTS[startingPoint]) };
    } catch (error) {
      reply.code(400); return { error: error instanceof Error ? error.message : "track could not be approved" };
    }
  });
  app.put<{ Params: { workItemId: string; stageKind: StageKind }; Body: SetStageStateBody }>("/api/work-items/:workItemId/stages/:stageKind", async (request, reply) => {
    const state = request.body?.state;
    if (typeof state !== "string" || !STAGE_STATES.includes(state as StageState)) {
      reply.code(400); return { error: "state must be not-started, running, waiting, blocked, done, or skipped" };
    }
    try { return { workItem: store.setStageState(request.params.workItemId, request.params.stageKind, state as StageState) }; }
    catch (error) { reply.code(400); return { error: error instanceof Error ? error.message : "stage could not be updated" }; }
  });
}
