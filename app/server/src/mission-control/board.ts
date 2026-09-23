import type { FastifyInstance } from "fastify";
import type { MissionControlBoard, MissionControlBoardItem, MissionControlRegion } from "@aios/contracts";
import type { CodeHost } from "@aios/connectors";
import type { WorkItemStore } from "../WorkItemStore.js";
import type { ArtifactStore } from "../ArtifactStore.js";
import type { PhaseStore } from "../PhaseStore.js";
import type { TaskStore } from "../TaskStore.js";
import type { SarathiStore } from "../sarathi/SarathiStore.js";

type Available<T> = Extract<MissionControlRegion<T>, { status: "available" }>;

async function region<T>(read: () => T | Promise<T>): Promise<MissionControlRegion<T>> {
  try { return { status: "available", data: await read() } satisfies Available<T>; }
  catch (error) { return { status: "error", reason: error instanceof Error ? error.message : "read failed" }; }
}

export function registerMissionControlBoardRoute(app: FastifyInstance, stores: {
  workItems: WorkItemStore;
  artifacts: ArtifactStore;
  phases: PhaseStore;
  tasks: TaskStore;
  sarathi: SarathiStore;
  codeHost?: CodeHost;
}): void {
  app.get("/api/mission-control/board", async (): Promise<MissionControlBoard> => {
    const storedDiscussions = stores.sarathi.snapshot().gitLabDiscussions;
    const gitLabDiscussions: MissionControlBoard["gitLabDiscussions"] = {
      sync: storedDiscussions.sync,
      observations: storedDiscussions.observations.map((observation) => ({
        id: observation.id,
        workItemId: observation.workItemId,
        repository: observation.mergeRequest.repository,
        mergeRequestIid: observation.mergeRequest.number,
        mergeRequestTitle: observation.mergeRequest.title,
        discussionId: observation.discussion.discussionId,
        resolved: observation.discussion.resolved,
        notes: observation.discussion.notes,
        askId: observation.askId,
        firstObservedAt: observation.firstObservedAt,
        lastObservedAt: observation.lastObservedAt,
        status: observation.status
      }))
    };
    const workItems = await region(() => stores.workItems.list());
    if (workItems.status !== "available") return { workItems, gitLabDiscussions };
    const items = await Promise.all(workItems.data.map(async (workItem): Promise<MissionControlBoardItem> => {
      const [phases, artifacts, mergeRequests] = await Promise.all([
        region(() => stores.phases.list(workItem.id).map((stored) => ({
          ...stored,
          tasks: stored.phase.taskIds.map((taskId) => stores.tasks.get(taskId)).filter((task) => task !== undefined).map((task) => ({ taskId: task.taskId, name: task.task, status: task.status }))
        }))),
        region(() => stores.artifacts.list(workItem.id)),
        stores.codeHost ? region(() => stores.codeHost!.listMergeRequests(workItem.id)) : Promise.resolve({ status: "unavailable" as const, reason: "code host is not configured" })
      ]);
      return {
        workItem,
        stages: { completed: workItem.stages.filter((stage) => stage.state === "done").length, total: workItem.stages.length },
        tasks: phases.status === "available" ? {
          completed: phases.data.flatMap((stored) => stored.tasks).filter((task) => task.status === "completed").length,
          total: phases.data.reduce((total, stored) => total + stored.phase.taskIds.length, 0)
        } : null,
        phases,
        artifacts,
        mergeRequests
      };
    }));
    return { workItems: { status: "available", data: items }, gitLabDiscussions };
  });
}
