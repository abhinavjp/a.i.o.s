import type { MissionControlBoard } from "@aios/contracts";

export type BoardLoad =
  | { status: "loading" }
  | { status: "available"; board: MissionControlBoard }
  | { status: "error"; message: string }
  | { status: "unsupported" };

export type ActionResult = { ok: true } | { ok: false; message: string };
export type ConnectorRead<T> = { status: "loading" } | { status: "available"; data: T } | { status: "unconfigured" } | { status: "error"; message: string };
export type ConnectorConnection = { siteUrl: string; credentialReference: string; daysUntilExpiry: number | null; expiresSoon: boolean };
export type JiraSyncEvidence = { configured: boolean; state: "unconfigured" | "idle" | "syncing" | "available" | "failed"; lastAttemptAt: string | null; lastSuccessAt: string | null; lastFailureAt: string | null; failed: boolean };
export type GitLabSyncEvidence = Pick<MissionControlBoard["gitLabDiscussions"]["sync"], "configured" | "state" | "stale" | "lastAttemptAt" | "lastSuccessAt" | "lastFailureAt"> & { failed: boolean };
export interface ConnectorOverview {
  workSource: ConnectorRead<ConnectorConnection>;
  codeHost: ConnectorRead<ConnectorConnection>;
  jiraSync: ConnectorRead<JiraSyncEvidence>;
  gitLabSync: ConnectorRead<GitLabSyncEvidence>;
}
export type JiraRefreshResult = { ok: true; imported: number; updated: number; skipped: number; missing: number } | { ok: false; message: string };
export type DiscussionRefreshResult = ActionResult;
export type DecisionTier = "ask" | "automatic";
export type AutopilotSettings = { low: DecisionTier; medium: DecisionTier; high: DecisionTier };

export function decideCanonicalAsk(askId: string, decision: "approved" | "declined"): Promise<ActionResult> {
  return sendAction(`/api/sarathi/asks/${encodeURIComponent(askId)}/decide`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision })
  });
}

export function undoCanonicalAutomaticDecision(decisionId: string): Promise<ActionResult> {
  return sendAction(`/api/sarathi/automatic-decisions/${encodeURIComponent(decisionId)}/undo`, { method: "POST" });
}

export function resolveCanonicalStandingRuleSuggestion(id: string, action: "accept" | "dismiss"): Promise<ActionResult> {
  return sendAction(`/api/sarathi/standing-rule-suggestions/${encodeURIComponent(id)}/${action}`, { method: "POST" });
}

export function setCanonicalStandingRule(id: string, enabled: boolean): Promise<ActionResult> {
  return sendAction(`/api/sarathi/standing-rules/${encodeURIComponent(id)}`, {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled })
  });
}

export function saveCanonicalAutopilot(settings: AutopilotSettings): Promise<ActionResult> {
  return sendAction("/api/sarathi/autopilot", {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(settings)
  });
}

async function sendAction(url: string, init: RequestInit): Promise<ActionResult> {
  try {
    const response = await fetch(url, init);
    let body: { error?: unknown; admission?: { reason?: unknown } } = {};
    try { body = await response.json() as typeof body; } catch { /* status remains the canonical failure evidence */ }
    if (response.ok) return { ok: true };
    const message = typeof body.error === "string" ? body.error : typeof body.admission?.reason === "string" ? body.admission.reason : `Sarathi rejected the action (${response.status})`;
    return { ok: false, message };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Sarathi action is unavailable" };
  }
}

export async function readMissionControlBoard(): Promise<BoardLoad> {
  try {
    const response = await fetch("/api/mission-control/board");
    if (response.ok === false) return { status: "error", message: `Mission Control read failed (${response.status})` };
    const data: unknown = await response.json();
    if (!isBoard(data)) return { status: "unsupported" };
    return { status: "available", board: data };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "Mission Control is unavailable" };
  }
}

export async function readConnectorOverview(): Promise<ConnectorOverview> {
  const [workSource, codeHost, jiraSync, gitLabSync] = await Promise.all([
    readConnection("/api/work-items/connection"),
    readConnection("/api/code-host/connection"),
    readJiraSync(),
    readGitLabSync()
  ]);
  return { workSource, codeHost, jiraSync, gitLabSync };
}

export async function saveCredentialToKeychain(reference: string, value: string): Promise<ActionResult> {
  try {
    const response = await fetch("/api/credentials/keychain", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reference: reference.trim(), value })
    });
    if (!response.ok) {
      const body: unknown = await response.json().catch(() => null);
      const error = body && typeof body === "object" && "error" in body && typeof body.error === "string" ? body.error : "";
      if (/Credential Manager save failed:\s*1312/.test(error)) return { ok: false, message: "Windows Credential Manager is unavailable in this session. Start Sarathi from your signed-in Windows desktop and try again." };
      return { ok: false, message: "Credential could not be stored. Check local keychain availability." };
    }
    return { ok: true };
  } catch {
    return { ok: false, message: "Credential could not be stored. Check local keychain availability." };
  }
}

export async function refreshJiraWorkItems(): Promise<JiraRefreshResult> {
  try {
    const response = await fetch("/api/work-items/import", { method: "POST" });
    if (!response.ok) return { ok: false, message: `Jira refresh failed (${response.status}). Check the connection and credential reference.` };
    const data: unknown = await response.json();
    if (!isJiraCountResult(data)) return { ok: false, message: "Jira refresh returned an incomplete result." };
    return { ok: true, imported: data.imported, updated: data.updated, skipped: data.skipped, missing: data.missing };
  } catch {
    return { ok: false, message: "Jira refresh is unavailable. Check the connection and credential reference." };
  }
}

export async function refreshGitLabDiscussions(): Promise<DiscussionRefreshResult> {
  try {
    const response = await fetch("/api/code-host/discussions/sync", { method: "POST" });
    if (!response.ok) return { ok: false, message: `GitLab discussion refresh failed (${response.status}).` };
    return { ok: true };
  } catch {
    return { ok: false, message: "GitLab discussion refresh is unavailable." };
  }
}

async function readConnection(path: string): Promise<ConnectorRead<ConnectorConnection>> {
  try {
    const response = await fetch(path);
    if (!response.ok) return { status: "error", message: "Connection check unavailable." };
    const body: unknown = await response.json();
    if (!body || typeof body !== "object" || !("connection" in body)) return { status: "error", message: "Connection check returned an incomplete result." };
    const connection = (body as { connection?: unknown }).connection;
    if (connection === null) return { status: "unconfigured" };
    if (!connection || typeof connection !== "object") return { status: "error", message: "Connection check returned an incomplete result." };
    const value = connection as Partial<ConnectorConnection>;
    if (typeof value.siteUrl !== "string" || typeof value.credentialReference !== "string" ||
      !(value.daysUntilExpiry === null || typeof value.daysUntilExpiry === "number" && Number.isFinite(value.daysUntilExpiry)) || typeof value.expiresSoon !== "boolean") {
      return { status: "error", message: "Connection check returned an incomplete result." };
    }
    return { status: "available", data: { siteUrl: value.siteUrl, credentialReference: value.credentialReference, daysUntilExpiry: value.daysUntilExpiry, expiresSoon: value.expiresSoon } };
  } catch {
    return { status: "error", message: "Connection check unavailable." };
  }
}

async function readJiraSync(): Promise<ConnectorRead<JiraSyncEvidence>> {
  try {
    const response = await fetch("/api/work-items/sync");
    if (!response.ok) return { status: "error", message: "Jira sync status unavailable." };
    const body: unknown = await response.json();
    if (!body || typeof body !== "object" || !("sync" in body)) return { status: "error", message: "Jira sync status is incomplete." };
    const sync = (body as { sync?: unknown }).sync;
    if (!sync || typeof sync !== "object") return { status: "error", message: "Jira sync status is incomplete." };
    const value = sync as Partial<JiraSyncEvidence> & { lastError?: unknown };
    if (typeof value.configured !== "boolean" || !isJiraSyncState(value.state) || !isNullableString(value.lastAttemptAt) || !isNullableString(value.lastSuccessAt) || !isNullableString(value.lastFailureAt)) return { status: "error", message: "Jira sync status is incomplete." };
    return { status: "available", data: { configured: value.configured, state: value.state, lastAttemptAt: value.lastAttemptAt, lastSuccessAt: value.lastSuccessAt, lastFailureAt: value.lastFailureAt, failed: value.state === "failed" || typeof value.lastError === "string" } };
  } catch {
    return { status: "error", message: "Jira sync status unavailable." };
  }
}

async function readGitLabSync(): Promise<ConnectorRead<GitLabSyncEvidence>> {
  try {
    const response = await fetch("/api/code-host/discussions/sync");
    if (!response.ok) return { status: "error", message: "GitLab discussion sync status unavailable." };
    const body: unknown = await response.json();
    if (!body || typeof body !== "object" || !("sync" in body)) return { status: "error", message: "GitLab discussion sync status is incomplete." };
    const sync = (body as { sync?: unknown }).sync;
    if (!sync || typeof sync !== "object") return { status: "error", message: "GitLab discussion sync status is incomplete." };
    const value = sync as Partial<MissionControlBoard["gitLabDiscussions"]["sync"]>;
    if (typeof value.configured !== "boolean" || !isGitLabSyncState(value.state) || typeof value.stale !== "boolean" || !isNullableString(value.lastAttemptAt) || !isNullableString(value.lastSuccessAt) || !isNullableString(value.lastFailureAt)) return { status: "error", message: "GitLab discussion sync status is incomplete." };
    return { status: "available", data: { configured: value.configured, state: value.state, stale: value.stale, lastAttemptAt: value.lastAttemptAt, lastSuccessAt: value.lastSuccessAt, lastFailureAt: value.lastFailureAt, failed: value.state === "failed" || typeof value.lastError === "string" } };
  } catch {
    return { status: "error", message: "GitLab discussion sync status unavailable." };
  }
}

function isCount(value: unknown): value is number { return typeof value === "number" && Number.isInteger(value) && value >= 0; }
function isJiraCountResult(value: unknown): value is { imported: number; updated: number; skipped: number; missing: number } {
  if (!value || typeof value !== "object") return false;
  const result = value as { imported?: unknown; updated?: unknown; skipped?: unknown; missing?: unknown };
  return isCount(result.imported) && isCount(result.updated) && isCount(result.skipped) && isCount(result.missing);
}
function isNullableString(value: unknown): value is string | null { return value === null || typeof value === "string"; }
function isJiraSyncState(value: unknown): value is JiraSyncEvidence["state"] { return value === "unconfigured" || value === "idle" || value === "syncing" || value === "available" || value === "failed"; }
function isGitLabSyncState(value: unknown): value is MissionControlBoard["gitLabDiscussions"]["sync"]["state"] { return value === "unconfigured" || value === "idle" || value === "syncing" || value === "available" || value === "failed"; }

function isBoard(value: unknown): value is MissionControlBoard {
  if (!value || typeof value !== "object") return false;
  const board = value as Partial<MissionControlBoard>;
  if (!board.workItems || typeof board.workItems !== "object" || !board.gitLabDiscussions || !Array.isArray(board.gitLabDiscussions.observations)) return false;
  const region = board.workItems;
  if (region.status === "available") return Array.isArray(region.data) && region.data.every((item) =>
    !!item && typeof item === "object" && !!item.workItem && typeof item.workItem.id === "string" && typeof item.workItem.title === "string" &&
    !!item.stages && typeof item.stages.completed === "number" && typeof item.stages.total === "number" &&
    (item.tasks === null || !!item.tasks && typeof item.tasks.completed === "number" && typeof item.tasks.total === "number"));
  return (region.status === "unavailable" || region.status === "error") && typeof region.reason === "string";
}
