import type { FastifyInstance } from "fastify";
import type { WorkItemStore } from "../WorkItemStore.js";
import type { AuthoredArtifactReference, StageKind, StageState, TaskStatus, ToolIntent } from "@aios/contracts";
import type { CodeHost, WorkSource } from "@aios/connectors";
import type { ArtifactStore } from "../ArtifactStore.js";
import type { PhaseStore } from "../PhaseStore.js";
import type { TaskStore } from "../TaskStore.js";
import type { SarathiStore } from "../sarathi/SarathiStore.js";
import type { PermissionEngine } from "../sarathi/PermissionEngine.js";
import type { JiraSyncCoordinator } from "../JiraSyncCoordinator.js";

interface CreateWorkItemBody { title?: unknown; repositories?: unknown; }
interface ApproveTrackBody { startingPoint?: unknown; }
interface SetStageStateBody { state?: unknown; }
interface TrackChangeBody { stageKind?: unknown; index?: unknown; }
interface AddPhaseTaskBody { taskId?: unknown; }
type CompletionCount = { completed: number; total: number } | null;

const STARTING_POINTS: Record<string, StageKind[]> = {
  full: ["functional-analysis", "technical-analysis", "spec-and-eval", "plan", "implementation", "final-review", "merge"],
  standard: ["technical-analysis", "spec-and-eval", "plan", "implementation", "final-review", "merge"],
  fast: ["plan", "implementation", "merge"],
  "analysis-only": ["functional-analysis", "technical-analysis"]
};
const STAGE_STATES: StageState[] = ["not-started", "running", "waiting", "blocked", "done", "skipped"];

export function registerWorkItemRoutes(app: FastifyInstance, store: WorkItemStore, workSource: WorkSource | undefined, codeHost: CodeHost | undefined, artifactStore: ArtifactStore | undefined, phaseStore: PhaseStore, taskStore: TaskStore, sarathiStore: SarathiStore, permissionEngine: PermissionEngine, onAllowedTrackChange: (intent: ToolIntent) => void, jiraSync: JiraSyncCoordinator): void {
  app.get("/api/work-items", async () => ({ workItems: store.list() }));
  app.get("/api/work-items/sync", async () => ({ sync: jiraSync.status() }));
  app.get("/api/code-host/connection", async (_request, reply) => { try { return { connection: await codeHost?.connectionStatus?.() ?? null }; } catch (error) { reply.code(502); return { error: `code host connection failed: ${error instanceof Error ? error.message : "unknown connection failure"}` }; } });
  app.get("/api/work-items/connection", async (_request, reply) => {
    try { return { connection: await workSource?.connectionStatus?.() ?? null }; }
    catch (error) { reply.code(502); return { error: `work source connection failed: ${error instanceof Error ? error.message : "unknown connection failure"}` }; }
  });
  const refreshWorkSource = async (_request: unknown, reply: { code(statusCode: number): unknown }) => {
    const result = await jiraSync.refresh();
    if (result.state === "failed") {
      reply.code(502);
      return { error: `work source import failed: ${result.error ?? "unknown connection failure"}`, sync: jiraSync.status() };
    }
    return { imported: result.imported, updated: result.updated, skipped: result.skipped, missing: result.missing, workItems: store.list(), sync: jiraSync.status() };
  };
  app.post("/api/work-items/import", refreshWorkSource);
  app.get<{ Params: { workItemId: string } }>("/api/work-items/:workItemId/merge-requests", async (request, reply) => {
    const workItem = store.list().find((candidate) => candidate.id === request.params.workItemId);
    if (!workItem) { reply.code(404); return { error: "work item was not found" }; }
    try { return { mergeRequests: await codeHost?.listMergeRequests(workItem.id) ?? [] }; }
    catch (error) { reply.code(502); return { mergeRequests: [], error: `code host read failed: ${error instanceof Error ? error.message : "unknown connection failure"}` }; }
  });
  app.get<{ Params: { artifactId: string } }>("/api/artifacts/:artifactId/content", async (request, reply) => {
    const artifact = artifactStore?.get(request.params.artifactId);
    if (!artifact) { reply.code(404); return { available: false }; }
    try {
      if (artifact.kind === "derived") {
        if (artifact.codeHostView === "phase-diff") return codeHost?.readDiffSummary(artifact.workItemId) ?? { available: false };
        const mergeRequests = await codeHost?.listMergeRequests(artifact.workItemId) ?? [];
        return { available: mergeRequests.length > 0, mergeRequests };
      }
      return codeHost?.readFile(artifact.branch, artifact.filePath) ?? { available: false, content: null };
    } catch (error) { reply.code(502); return { available: false, error: `code host read failed: ${error instanceof Error ? error.message : "unknown connection failure"}` }; }
  });
  app.get<{ Params: { workItemId: string } }>("/api/work-items/:workItemId/artifacts", async (request) => ({ artifacts: artifactStore?.list(request.params.workItemId) ?? [] }));
  app.get<{ Params: { workItemId: string } }>("/api/work-items/:workItemId/phases", async (request) => ({ phases: phaseStore.list(request.params.workItemId).map((stored) => ({ ...stored, tasks: stored.phase.taskIds.map((taskId) => {
    const task = taskStore.get(taskId);
    return task ? { taskId: task.taskId, name: task.task, agent: task.resolvedExecutionPlan?.route.runtime ?? task.executedEngineRoute?.engine ?? "unknown", status: task.status } : null;
  }).filter((task): task is { taskId: string; name: string; agent: string; status: TaskStatus } => task !== null) })) }));
  app.get<{ Params: { workItemId: string } }>("/api/work-items/:workItemId/progress", async (request, reply) => {
    const workItem = store.list().find((candidate) => candidate.id === request.params.workItemId);
    if (!workItem) { reply.code(404); return { error: "work item was not found" }; }
    const artifacts = artifactStore?.list(workItem.id) ?? [];
    const checklistCount = async (stageKind: StageKind): Promise<CompletionCount> => {
      const references = latestAuthoredArtifacts(artifacts.filter((artifact) => artifact.stageKind === stageKind));
      const contents = await Promise.all(references.map((artifact) => codeHost?.readFile(artifact.branch, artifact.filePath)));
      const counts = contents.flatMap((content) => content?.available && content.content ? [countChecklist(content.content)] : []).filter((count): count is NonNullable<CompletionCount> => count !== null);
      return counts.length === 0 ? null : counts.reduce((total, count) => ({ completed: total.completed + count.completed, total: total.total + count.total }), { completed: 0, total: 0 });
    };
    try {
      const [tasks, checks, diff, mergeRequests] = await Promise.all([
        checklistCount("plan"), checklistCount("spec-and-eval"), codeHost?.readDiffSummary(workItem.id), codeHost?.listMergeRequests(workItem.id) ?? []
      ]);
      const pipelineJobs = mergeRequests.length === 0 ? null : mergeRequests.reduce((total, mergeRequest) => ({ completed: total.completed + mergeRequest.jobsCompleted, total: total.total + mergeRequest.jobsTotal }), { completed: 0, total: 0 });
      return { progress: { tasks, checks, diff: diff?.available ? { filesChanged: diff.filesChanged, linesAdded: diff.linesAdded, linesRemoved: diff.linesRemoved } : null, pipelineJobs } };
    } catch (error) { reply.code(502); return { progress: null, error: `code host read failed: ${error instanceof Error ? error.message : "unknown connection failure"}` }; }
  });
  app.post<{ Params: { workItemId: string; phaseNumber: string }; Body: AddPhaseTaskBody }>("/api/work-items/:workItemId/phases/:phaseNumber/tasks", async (request, reply) => {
    const { taskId } = request.body ?? {};
    const phaseNumber = Number(request.params.phaseNumber);
    if (typeof taskId !== "string" || !taskId.trim()) { reply.code(400); return { error: "taskId is required" }; }
    if (!Number.isInteger(phaseNumber)) { reply.code(400); return { error: "phase number must be an integer" }; }
    if (!taskStore.get(taskId)) { reply.code(400); return { error: `task was not found: ${taskId}` }; }
    try {
      phaseStore.addTask(request.params.workItemId, phaseNumber, taskId);
      const task = taskStore.get(taskId);
      if (task) sarathiStore.recordTask(task, request.params.workItemId);
      return { phases: phaseStore.list(request.params.workItemId) };
    }
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
  app.post<{ Params: { workItemId: string }; Body: TrackChangeBody }>("/api/work-items/:workItemId/track/changes", async (request, reply) => {
    const { stageKind, index } = request.body ?? {};
    if (typeof stageKind !== "string" || !isStageKind(stageKind)) { reply.code(400); return { error: "stageKind must be a valid stage kind" }; }
    if (typeof index !== "number" || !Number.isInteger(index) || index < 0) { reply.code(400); return { error: "index must be a non-negative integer" }; }
    const stageIndex = index;
    const workItem = store.list().find((candidate) => candidate.id === request.params.workItemId);
    if (!workItem) { reply.code(400); return { error: "work item was not found" }; }
    if (!workItem.track) { reply.code(400); return { error: "a track must be approved before adding a stage" }; }
    if (workItem.track.stages.includes(stageKind)) { reply.code(400); return { error: `stage ${stageKind} is already in this work item's track` }; }
    if (stageIndex > workItem.track.stages.length) { reply.code(400); return { error: "stage index is outside this work item's track" }; }
    const currentTrack = [...workItem.track.stages];
    const proposedTrack = [...currentTrack]; proposedTrack.splice(stageIndex, 0, stageKind);
    const intent: ToolIntent = { tool: "delivery-pipeline", operation: "track.change", target: workItem.id, context: {
      workItemId: workItem.id, stageKind, index: String(stageIndex), currentTrack: JSON.stringify(currentTrack), proposedTrack: JSON.stringify(proposedTrack)
    } };
    const result = await permissionEngine.execute(intent);
    if (result.decision.outcome === "allowed") onAllowedTrackChange(intent);
    reply.code(result.decision.outcome === "requires_approval" ? 202 : result.decision.outcome === "allowed" ? 200 : 403);
    return result;
  });
  app.put<{ Params: { workItemId: string; stageKind: StageKind }; Body: SetStageStateBody }>("/api/work-items/:workItemId/stages/:stageKind", async (request, reply) => {
    const state = request.body?.state;
    if (typeof state !== "string" || !STAGE_STATES.includes(state as StageState)) {
      reply.code(400); return { error: "state must be not-started, running, waiting, blocked, done, or skipped" };
    }
    const previousState = store.list().find((workItem) => workItem.id === request.params.workItemId)?.stages.find((stage) => stage.kind === request.params.stageKind)?.state;
    let workItem: ReturnType<WorkItemStore["setStageState"]> | undefined;
    try {
      workItem = store.setStageState(request.params.workItemId, request.params.stageKind, state as StageState);
      if (previousState !== state) sarathiStore.recordStageState(store.stageActivity().at(-1)!);
      return { workItem };
    }
    catch (error) {
      if (workItem && previousState) {
        try { store.setStageState(workItem.id, request.params.stageKind, previousState); }
        catch { /* A failed rollback is surfaced as a server error, never an accepted stage change. */ }
        reply.code(500);
        return { error: "stage activity could not be recorded" };
      }
      reply.code(400); return { error: error instanceof Error ? error.message : "stage could not be updated" };
    }
  });
}

function isStageKind(value: string): value is StageKind {
  return ["functional-analysis", "technical-analysis", "spec-and-eval", "plan", "implementation", "final-review", "merge"].includes(value);
}

function countChecklist(content: string): CompletionCount {
  const entries = [...content.matchAll(/^\s*[-*+]\s+\[([ xX])\]\s+/gm)];
  return entries.length === 0 ? null : { completed: entries.filter((entry) => entry[1].toLowerCase() === "x").length, total: entries.length };
}

function latestAuthoredArtifacts(artifacts: ReturnType<ArtifactStore["list"]>): AuthoredArtifactReference[] {
  const latest = new Map<string, AuthoredArtifactReference>();
  for (const artifact of artifacts) if (artifact.kind === "authored") {
    const current = latest.get(artifact.name);
    if (!current || artifact.version > current.version) latest.set(artifact.name, artifact);
  }
  return [...latest.values()];
}
