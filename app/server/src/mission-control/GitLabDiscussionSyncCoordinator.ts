import type { CodeHost, MergeRequest, MergeRequestDiscussion } from "@aios/connectors";
import type { WorkItemStore } from "../WorkItemStore.js";
import type { SarathiStore } from "../sarathi/SarathiStore.js";
import type { JiraSyncScheduler } from "../JiraSyncCoordinator.js";

const DEFAULT_SYNC_INTERVAL_MS = 5 * 60 * 1000;

export interface GitLabDiscussionSyncResult {
  state: "unconfigured" | "idle" | "syncing" | "available" | "failed";
  observations: number;
  asksCreated: number;
  error: string | null;
}

export interface GitLabDiscussionSyncCoordinatorOptions {
  codeHost?: CodeHost;
  workItems: WorkItemStore;
  sarathi: SarathiStore;
  intervalMs?: number;
  now?: () => number;
  scheduler?: JiraSyncScheduler;
}

const systemScheduler: JiraSyncScheduler = {
  setInterval(callback, intervalMs) {
    const handle = globalThis.setInterval(callback, intervalMs);
    handle.unref?.();
    return handle;
  },
  clearInterval(handle) { globalThis.clearInterval(handle as ReturnType<typeof globalThis.setInterval>); }
};

/** Persists read-only GitLab discussion observations through one startup, refresh and interval path. */
export class GitLabDiscussionSyncCoordinator {
  private readonly intervalMs: number;
  private readonly now: () => number;
  private readonly scheduler: JiraSyncScheduler;
  private started = false;
  private closed = false;
  private timer: unknown;
  private inFlight: Promise<GitLabDiscussionSyncResult> | undefined;

  constructor(private readonly options: GitLabDiscussionSyncCoordinatorOptions) {
    const requestedInterval = options.intervalMs ?? configuredInterval();
    this.intervalMs = Number.isFinite(requestedInterval) && requestedInterval > 0 ? requestedInterval : DEFAULT_SYNC_INTERVAL_MS;
    this.now = options.now ?? Date.now;
    this.scheduler = options.scheduler ?? systemScheduler;
  }

  status() { return this.options.sarathi.snapshot().gitLabDiscussions.sync; }

  async start(): Promise<GitLabDiscussionSyncResult> {
    if (this.started || this.closed) return this.inFlight ?? this.emptyResult();
    this.started = true;
    if (!this.options.codeHost) return this.emptyResult();
    this.timer = this.scheduler.setInterval(() => { void this.refresh(); }, this.intervalMs);
    return this.refresh();
  }

  refresh(): Promise<GitLabDiscussionSyncResult> {
    if (this.closed || !this.options.codeHost) return Promise.resolve(this.emptyResult());
    if (this.inFlight) return this.inFlight;
    const attemptedAt = this.timestamp();
    this.options.sarathi.markGitLabDiscussionSyncing(attemptedAt);
    const operation = this.performSync(attemptedAt);
    this.inFlight = operation;
    void operation.finally(() => {
      if (this.inFlight === operation) this.inFlight = undefined;
    }).catch(() => undefined);
    return operation;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.timer !== undefined) this.scheduler.clearInterval(this.timer);
    await this.inFlight?.catch(() => undefined);
  }

  private async performSync(attemptedAt: string): Promise<GitLabDiscussionSyncResult> {
    try {
      const observations = [];
      for (const workItem of this.options.workItems.list()) {
        const mergeRequests = validateMergeRequests(await this.options.codeHost!.listMergeRequests(workItem.id));
        for (const mergeRequest of mergeRequests) {
          const discussions = validateDiscussions(await this.options.codeHost!.listDiscussions(mergeRequest.number), mergeRequest);
          for (const discussion of discussions) observations.push({ workItemId: workItem.id, mergeRequest, discussion });
        }
      }
      const observedAt = this.timestamp();
      const result = this.options.sarathi.applyGitLabDiscussionObservationBatch(observations, observedAt);
      return { state: "available", observations: result.observations, asksCreated: result.asksCreated, error: null };
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown connection failure";
      this.options.sarathi.markGitLabDiscussionSyncFailed(attemptedAt, message);
      return { state: "failed", observations: 0, asksCreated: 0, error: message };
    }
  }

  private timestamp(): string {
    const now = this.now();
    if (!Number.isFinite(now)) throw new Error("GitLab discussion sync clock returned an invalid time");
    return new Date(now).toISOString();
  }

  private emptyResult(): GitLabDiscussionSyncResult {
    const status = this.status();
    return { state: status.state, observations: 0, asksCreated: 0, error: status.lastError };
  }
}

function validateMergeRequests(value: unknown): MergeRequest[] {
  if (!Array.isArray(value)) throw new Error("GitLab merge request read returned an invalid batch");
  return value.map((entry) => {
    if (!entry || typeof entry !== "object") throw new Error("GitLab merge request read returned an invalid merge request");
    const mergeRequest = entry as Partial<MergeRequest>;
    if (typeof mergeRequest.repository !== "string" || !mergeRequest.repository.trim() || !Number.isSafeInteger(mergeRequest.number) || !mergeRequest.number ||
      typeof mergeRequest.title !== "string" || typeof mergeRequest.branch !== "string" || typeof mergeRequest.state !== "string" ||
      !["passed", "failed", "running"].includes(mergeRequest.pipelineResult ?? "") || !Number.isSafeInteger(mergeRequest.jobsCompleted) || !Number.isSafeInteger(mergeRequest.jobsTotal)) {
      throw new Error("GitLab merge request read returned an incomplete merge request");
    }
    return mergeRequest as MergeRequest;
  });
}

function validateDiscussions(value: unknown, mergeRequest: MergeRequest): MergeRequestDiscussion[] {
  if (!Array.isArray(value)) throw new Error("GitLab discussion read returned an invalid batch");
  return value.map((entry) => {
    if (!entry || typeof entry !== "object") throw new Error("GitLab discussion read returned an invalid discussion");
    const discussion = entry as Partial<MergeRequestDiscussion>;
    if (typeof discussion.projectId !== "string" || !discussion.projectId.trim() || discussion.projectId !== mergeRequest.repository ||
      discussion.mergeRequestIid !== mergeRequest.number || typeof discussion.discussionId !== "string" || !discussion.discussionId.trim() ||
      typeof discussion.resolved !== "boolean" || !Array.isArray(discussion.notes)) {
      throw new Error("GitLab discussion read returned an incomplete discussion");
    }
    return discussion as MergeRequestDiscussion;
  });
}

function configuredInterval(): number {
  const configured = Number(process.env.AIOS_GITLAB_DISCUSSION_SYNC_INTERVAL_MS);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_SYNC_INTERVAL_MS;
}
