import type { WorkSource, WorkSourceTicket } from "@aios/connectors";
import type { WorkItemStore } from "./WorkItemStore.js";

const DEFAULT_SYNC_INTERVAL_MS = 5 * 60 * 1000;

export interface JiraSyncScheduler {
  setInterval(callback: () => void, intervalMs: number): unknown;
  clearInterval(handle: unknown): void;
}

export type JiraSyncState = "unconfigured" | "idle" | "syncing" | "available" | "failed";

export interface JiraSyncStatus {
  configured: boolean;
  state: JiraSyncState;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastError: string | null;
}

export interface JiraSyncResult {
  state: JiraSyncState;
  imported: number;
  updated: number;
  skipped: number;
  missing: number;
  error: string | null;
}

export interface JiraSyncCoordinatorOptions {
  source?: WorkSource;
  store: WorkItemStore;
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
  clearInterval(handle) {
    globalThis.clearInterval(handle as ReturnType<typeof globalThis.setInterval>);
  }
};

/** Runs read-only Jira observations through one startup, refresh and interval path. */
export class JiraSyncCoordinator {
  private readonly intervalMs: number;
  private readonly now: () => number;
  private readonly scheduler: JiraSyncScheduler;
  private started = false;
  private closed = false;
  private timer: unknown;
  private inFlight: Promise<JiraSyncResult> | undefined;
  private currentStatus: JiraSyncStatus;

  constructor(private readonly options: JiraSyncCoordinatorOptions) {
    const requestedInterval = options.intervalMs ?? configuredInterval();
    this.intervalMs = Number.isFinite(requestedInterval) && requestedInterval > 0 ? requestedInterval : DEFAULT_SYNC_INTERVAL_MS;
    this.now = options.now ?? Date.now;
    this.scheduler = options.scheduler ?? systemScheduler;
    this.currentStatus = {
      configured: Boolean(options.source),
      state: options.source ? "idle" : "unconfigured",
      lastAttemptAt: null,
      lastSuccessAt: null,
      lastFailureAt: null,
      lastError: null
    };
  }

  status(): JiraSyncStatus { return { ...this.currentStatus }; }

  async start(): Promise<JiraSyncResult> {
    if (this.started || this.closed) return this.inFlight ?? this.emptyResult();
    this.started = true;
    if (!this.options.source) return this.emptyResult();
    this.timer = this.scheduler.setInterval(() => { void this.refresh(); }, this.intervalMs);
    return this.refresh();
  }

  refresh(): Promise<JiraSyncResult> {
    if (this.closed || !this.options.source) return Promise.resolve(this.emptyResult());
    if (this.inFlight) return this.inFlight;

    const attemptedAt = this.timestamp();
    this.currentStatus = { ...this.currentStatus, state: "syncing", lastAttemptAt: attemptedAt, lastError: null };
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

  private async performSync(attemptedAt: string): Promise<JiraSyncResult> {
    try {
      const rawTickets: unknown = await this.options.source!.listAssignedTickets();
      const tickets = validateTicketBatch(rawTickets);
      const uniqueTickets = new Map<string, WorkSourceTicket>();
      for (const ticket of tickets) uniqueTickets.set(ticket.key, ticket);

      const observedAt = this.timestamp();
      const { imported, updated, missing } = this.options.store.applySourceObservationBatch(
        [...uniqueTickets.values()].map((ticket) => ({
          workSourceKey: ticket.key,
          title: ticket.title,
          state: ticket.status,
          observedAt
        })),
        observedAt
      );

      this.currentStatus = {
        ...this.currentStatus,
        state: "available",
        lastSuccessAt: observedAt,
        lastFailureAt: null,
        lastError: null
      };
      return { state: "available", imported, updated, skipped: tickets.length - imported, missing, error: null };
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown connection failure";
      this.currentStatus = {
        ...this.currentStatus,
        state: "failed",
        lastFailureAt: attemptedAt,
        lastError: message
      };
      return { state: "failed", imported: 0, updated: 0, skipped: 0, missing: 0, error: message };
    }
  }

  private timestamp(): string {
    const now = this.now();
    if (!Number.isFinite(now)) throw new Error("Jira sync clock returned an invalid time");
    return new Date(now).toISOString();
  }

  private emptyResult(): JiraSyncResult {
    return { state: this.currentStatus.state, imported: 0, updated: 0, skipped: 0, missing: 0, error: null };
  }
}

function validateTicketBatch(value: unknown): WorkSourceTicket[] {
  if (!Array.isArray(value)) throw new Error("Jira search returned an invalid ticket batch");
  return value.map((ticket) => {
    if (!ticket || typeof ticket !== "object") throw new Error("Jira search returned an invalid ticket");
    const item = ticket as Partial<WorkSourceTicket>;
    if (typeof item.key !== "string" || !item.key.trim() ||
      typeof item.title !== "string" || !item.title.trim() ||
      typeof item.type !== "string" || !item.type.trim() ||
      typeof item.status !== "string" || !item.status.trim() ||
      typeof item.description !== "string") {
      throw new Error("Jira search returned an incomplete ticket");
    }
    return { ...item, key: item.key.trim(), title: item.title.trim(), type: item.type.trim(), status: item.status.trim(), description: item.description };
  });
}

function configuredInterval(): number {
  const configured = Number(process.env.AIOS_JIRA_SYNC_INTERVAL_MS);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_SYNC_INTERVAL_MS;
}
