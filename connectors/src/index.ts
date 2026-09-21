import { ADHISTHANA_BRANCH_PREFIX, adhisthanaBranch, isAdhisthanaBranch } from "@aios/contracts";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import { spawn } from "node:child_process";
export { ADHISTHANA_BRANCH_PREFIX, adhisthanaBranch, isAdhisthanaBranch } from "@aios/contracts";
export interface WorkSourceTicket { key: string; title: string; type: string; status: string; description: string; }
export interface WorkSourceConnection { siteUrl: string; credentialReference: string; daysUntilExpiry: number | null; expiresSoon: boolean; }
export interface WorkSource {
  listAssignedTickets(): Promise<ReadonlyArray<WorkSourceTicket>>;
  readTicket(ticketKey: string): Promise<WorkSourceTicket | null>;
  connectionStatus?(): Promise<WorkSourceConnection>;
}

export interface JiraIssue { key: string; fields: { summary: string; issuetype: { name: string }; status: { name: string }; description: unknown; }; }
export interface CredentialResolver { resolve(reference: string): Promise<{ value: string; expiresAt?: string }>; }
export type JiraCredentialResolver = CredentialResolver;

export type CredentialReference =
  | { reference: string; source: "keychain"; keychainEntry: string }
  | { reference: string; source: "command"; commandReference: string };
export interface CredentialReferenceDocument { schemaVersion: number; credentials: Record<string, CredentialReference>; }
export interface CredentialReferenceStore { snapshot(): CredentialReferenceDocument; save(credential: CredentialReference): void; get(reference: string): CredentialReference | null; }

const CREDENTIAL_SCHEMA_VERSION = 1;
export const SECRET_COMMAND_REFERENCE = /^[A-Z][A-Z0-9_]*$/;
export class FileCredentialReferenceStore implements CredentialReferenceStore {
  private document: CredentialReferenceDocument;
  private migratedOnOpen = false;
  constructor(private readonly filePath: string) { this.document = this.load(); if (this.migratedOnOpen) this.persist(); }
  snapshot(): CredentialReferenceDocument { return cloneCredential(this.document); }
  save(credential: CredentialReference): void { this.document.credentials[credential.reference] = cloneCredential(credential); this.persist(); }
  get(reference: string): CredentialReference | null { const credential = this.document.credentials[reference]; return credential ? cloneCredential(credential) : null; }
  private load(): CredentialReferenceDocument {
    if (!existsSync(this.filePath)) return { schemaVersion: CREDENTIAL_SCHEMA_VERSION, credentials: {} };
    const parsed: unknown = JSON.parse(readFileSync(this.filePath, "utf8"));
    if (!parsed || typeof parsed !== "object") throw new Error(`Invalid credential reference document: ${this.filePath}`);
    const version = (parsed as { schemaVersion?: unknown }).schemaVersion ?? 0;
    if (!Number.isInteger(version) || typeof version !== "number") throw new Error(`Invalid credential reference schema version: ${this.filePath}`);
    if (version > CREDENTIAL_SCHEMA_VERSION) throw new Error(`Credential reference schema version ${version} is newer than supported version ${CREDENTIAL_SCHEMA_VERSION}`);
    const credentials = (parsed as { credentials?: unknown }).credentials ?? {};
    if (!credentials || typeof credentials !== "object" || Array.isArray(credentials)) throw new Error(`Invalid credential reference document: ${this.filePath}`);
    for (const [reference, credential] of Object.entries(credentials)) validateCredentialReference(reference, credential);
    this.migratedOnOpen = version < CREDENTIAL_SCHEMA_VERSION;
    return { schemaVersion: CREDENTIAL_SCHEMA_VERSION, credentials: cloneCredential(credentials as Record<string, CredentialReference>) };
  }
  private persist(): void { mkdirSync(dirname(this.filePath), { recursive: true }); const temporaryPath = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`; writeFileSync(temporaryPath, JSON.stringify(this.document, null, 2), "utf8"); renameSync(temporaryPath, this.filePath); }
}

export interface OperatingSystemKeychain { save(entry: string, value: string): Promise<void>; read(entry: string): Promise<{ value: string; expiresAt?: string } | null>; }
export interface SecretCommandRunner { run(commandReference: string): Promise<string>; }
export interface CredentialStrategy { save?(credential: CredentialReference, value: string): Promise<void>; resolve(credential: CredentialReference): Promise<{ value: string; expiresAt?: string }>; }
export class KeychainCredentialStrategy implements CredentialStrategy {
  constructor(private readonly keychain: OperatingSystemKeychain) {}
  async save(credential: CredentialReference, value: string): Promise<void> { if (credential.source !== "keychain") throw new Error("keychain strategy requires a keychain reference"); await this.keychain.save(credential.keychainEntry, value); }
  async resolve(credential: CredentialReference): Promise<{ value: string; expiresAt?: string }> { if (credential.source !== "keychain") throw new Error("keychain strategy requires a keychain reference"); const found = await this.keychain.read(credential.keychainEntry); if (!found) throw new Error(`Credential keychain entry is missing: ${credential.keychainEntry}`); return found; }
}
export class SecretCommandCredentialStrategy implements CredentialStrategy {
  constructor(private readonly runner: SecretCommandRunner) {}
  async resolve(credential: CredentialReference): Promise<{ value: string }> { if (credential.source !== "command") throw new Error("secret command strategy requires a command reference"); const value = (await this.runner.run(credential.commandReference)).trim(); if (!value) throw new Error(`Secret command returned no value for credential reference: ${credential.reference}`); return { value }; }
}
export class MissingCredentialStrategy implements CredentialStrategy { async resolve(credential: CredentialReference): Promise<never> { throw new Error(`Credential source is not configured for reference: ${credential.reference}`); } }
export class CredentialConfigurator {
  private readonly strategies = new Map<CredentialReference["source"], CredentialStrategy>();
  private readonly fallback = new MissingCredentialStrategy();
  register(source: CredentialReference["source"], strategy: CredentialStrategy): void { this.strategies.set(source, strategy); }
  resolve(source: CredentialReference["source"]): CredentialStrategy { return this.strategies.get(source) ?? this.fallback; }
  getFallback(): CredentialStrategy { return this.fallback; }
}
export class CredentialManager implements CredentialResolver {
  constructor(private readonly store: CredentialReferenceStore, private readonly configurator: CredentialConfigurator) {}
  async saveToKeychain(reference: string, value: string, keychainEntry = reference): Promise<void> { const credential: CredentialReference = { reference, source: "keychain", keychainEntry }; const strategy = this.configurator.resolve("keychain"); if (!strategy.save) throw new Error("Credential keychain saving is not configured"); await strategy.save(credential, value); this.store.save(credential); }
  saveSecretCommand(reference: string, commandReference: string): void { if (!SECRET_COMMAND_REFERENCE.test(commandReference)) throw new Error("secret command reference must be an environment-variable name"); this.store.save({ reference, source: "command", commandReference }); }
  async resolve(reference: string): Promise<{ value: string; expiresAt?: string }> { const credential = this.store.get(reference); if (!credential) throw new Error(`Credential reference is not configured: ${reference}`); return this.configurator.resolve(credential.source).resolve(credential); }
}

/** Windows Credential Manager adapter. The secret is supplied over stdin and is never written to the reference store. */
export class WindowsCredentialManagerKeychain implements OperatingSystemKeychain {
  async save(entry: string, value: string): Promise<void> { await runPowerShell(WINDOWS_KEYCHAIN_SCRIPT, ["save", entry], value); }
  async read(entry: string): Promise<{ value: string } | null> { const encoded = (await runPowerShell(WINDOWS_KEYCHAIN_SCRIPT, ["read", entry])).trim(); return encoded ? { value: Buffer.from(encoded, "base64").toString("utf8") } : null; }
}
/** Resolves a command from an environment variable at use time; state stores only that variable name. */
export class EnvironmentSecretCommandRunner implements SecretCommandRunner {
  async run(commandReference: string): Promise<string> {
    const command = process.env[commandReference];
    if (!command) throw new Error(`Secret command is not configured: ${commandReference}`);
    return runCommand(command);
  }
}
export function createOperatingSystemKeychain(): OperatingSystemKeychain | null { return process.platform === "win32" ? new WindowsCredentialManagerKeychain() : null; }

const WINDOWS_KEYCHAIN_SCRIPT = `param([string]$operation, [string]$entry)
Add-Type @'
using System; using System.Runtime.InteropServices;
public static class AiosCredential {
 [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] public struct CREDENTIAL { public UInt32 Flags; public UInt32 Type; public string TargetName; public string Comment; public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten; public UInt32 CredentialBlobSize; public IntPtr CredentialBlob; public UInt32 Persist; public UInt32 AttributeCount; public IntPtr Attributes; public string TargetAlias; public string UserName; }
 [DllImport("Advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern bool CredWrite(ref CREDENTIAL credential, UInt32 flags);
 [DllImport("Advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern bool CredRead(string target, UInt32 type, UInt32 flags, out IntPtr credentialPtr);
 [DllImport("Advapi32.dll", SetLastError=true)] public static extern void CredFree(IntPtr credential);
}
'@
$target = "Adhisthana:" + $entry
if ($operation -eq "save") { $bytes = [Text.Encoding]::UTF8.GetBytes([Console]::In.ReadToEnd()); $blob = [Runtime.InteropServices.Marshal]::AllocHGlobal($bytes.Length); try { [Runtime.InteropServices.Marshal]::Copy($bytes, 0, $blob, $bytes.Length); $credential = New-Object AiosCredential+CREDENTIAL; $credential.Type = 1; $credential.TargetName = $target; $credential.CredentialBlobSize = $bytes.Length; $credential.CredentialBlob = $blob; $credential.Persist = 2; $credential.UserName = "Adhisthana"; if (-not [AiosCredential]::CredWrite([ref]$credential, 0)) { throw "Credential Manager save failed: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())" } } finally { [Runtime.InteropServices.Marshal]::FreeHGlobal($blob) }; exit 0 }
$pointer = [IntPtr]::Zero; if (-not [AiosCredential]::CredRead($target, 1, 0, [ref]$pointer)) { $error = [Runtime.InteropServices.Marshal]::GetLastWin32Error(); if ($error -eq 1168) { exit 0 }; throw "Credential Manager read failed: $error" }; try { $credential = [Runtime.InteropServices.Marshal]::PtrToStructure($pointer, [type][AiosCredential+CREDENTIAL]); $bytes = New-Object byte[] $credential.CredentialBlobSize; [Runtime.InteropServices.Marshal]::Copy($credential.CredentialBlob, $bytes, 0, $bytes.Length); [Console]::Out.Write([Convert]::ToBase64String($bytes)) } finally { [AiosCredential]::CredFree($pointer) }`;
function runPowerShell(script: string, args: ReadonlyArray<string>, input?: string): Promise<string> { return runProcess("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script, ...args], input); }
function runCommand(command: string): Promise<string> { return runProcess(process.platform === "win32" ? "cmd.exe" : "/bin/sh", process.platform === "win32" ? ["/d", "/s", "/c", command] : ["-c", command]); }
function runProcess(command: string, args: ReadonlyArray<string>, input?: string): Promise<string> { return new Promise((resolve, reject) => { const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] }); let stdout = ""; let stderr = ""; child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); }); child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); }); child.on("error", reject); child.on("close", (code) => code === 0 ? resolve(stdout) : reject(new Error(`${command} failed${stderr ? `: ${stderr.trim()}` : ""}`))); child.stdin.end(input); }); }

function validateCredentialReference(reference: string, credential: unknown): asserts credential is CredentialReference {
  if (!credential || typeof credential !== "object" || !reference.trim()) throw new Error("Invalid credential reference document");
  const value = credential as Partial<CredentialReference>;
  if (value.reference !== reference || (value.source !== "keychain" && value.source !== "command")) throw new Error("Invalid credential reference document");
  if (value.source === "keychain" && (typeof value.keychainEntry !== "string" || !value.keychainEntry.trim())) throw new Error("Invalid credential reference document");
  if (value.source === "command" && (typeof value.commandReference !== "string" || !SECRET_COMMAND_REFERENCE.test(value.commandReference))) throw new Error("Invalid credential reference document");
}
function cloneCredential<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
export interface JiraTransport {
  search(input: { siteUrl: string; searchQuery: string; token: string }): Promise<ReadonlyArray<JiraIssue>>;
  read(input: { siteUrl: string; ticketKey: string; token: string }): Promise<JiraIssue | null>;
}
export interface JiraWorkSourceOptions { siteUrl: string; searchQuery: string; credentialReference: string; credentialResolver: JiraCredentialResolver; transport?: JiraTransport; expiryWarningDays?: number; }

/** Jira REST transport for an operator-provided site; tests can replace it with a fake. */
export class FetchJiraTransport implements JiraTransport {
  async search(input: { siteUrl: string; searchQuery: string; token: string }): Promise<ReadonlyArray<JiraIssue>> {
    const response = await fetch(`${input.siteUrl.replace(/\/$/, "")}/rest/api/3/search?${new URLSearchParams({ jql: input.searchQuery, fields: "summary,issuetype,status,description" })}`, { headers: { Authorization: `Bearer ${input.token}`, Accept: "application/json" } });
    if (!response.ok) throw new Error(`Jira search failed (${response.status})`);
    return (await response.json() as { issues?: JiraIssue[] }).issues ?? [];
  }
  async read(input: { siteUrl: string; ticketKey: string; token: string }): Promise<JiraIssue | null> {
    const response = await fetch(`${input.siteUrl.replace(/\/$/, "")}/rest/api/3/issue/${encodeURIComponent(input.ticketKey)}?${new URLSearchParams({ fields: "summary,issuetype,status,description" })}`, { headers: { Authorization: `Bearer ${input.token}`, Accept: "application/json" } });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`Jira ticket read failed (${response.status})`);
    return await response.json() as JiraIssue;
  }
}

/** Read-only Jira work source; credentials remain external and are resolved only for each call. */
export class JiraWorkSource implements WorkSource {
  constructor(private readonly options: JiraWorkSourceOptions, private readonly now: () => number = Date.now) {}

  async listAssignedTickets(): Promise<ReadonlyArray<WorkSourceTicket>> {
    const credential = await this.credential();
    return (await this.transport.search({ siteUrl: this.options.siteUrl, searchQuery: this.options.searchQuery, token: credential.value })).map(toWorkSourceTicket);
  }

  async readTicket(ticketKey: string): Promise<WorkSourceTicket | null> {
    const credential = await this.credential();
    const ticket = await this.transport.read({ siteUrl: this.options.siteUrl, ticketKey, token: credential.value });
    return ticket ? toWorkSourceTicket(ticket) : null;
  }

  async connectionStatus(): Promise<WorkSourceConnection> {
    const credential = await this.credential();
    const expiresAt = credential.expiresAt ? Date.parse(credential.expiresAt) : Number.NaN;
    const daysUntilExpiry = Number.isFinite(expiresAt) ? Math.max(0, Math.ceil((expiresAt - this.now()) / 86_400_000)) : null;
    return { siteUrl: this.options.siteUrl, credentialReference: this.options.credentialReference, daysUntilExpiry,
      expiresSoon: daysUntilExpiry !== null && daysUntilExpiry <= (this.options.expiryWarningDays ?? 7) };
  }

  private credential() { return this.options.credentialResolver.resolve(this.options.credentialReference); }
  private get transport() { return this.options.transport ?? new FetchJiraTransport(); }
}

function toWorkSourceTicket(ticket: JiraIssue): WorkSourceTicket {
  return { key: ticket.key, title: ticket.fields.summary, type: ticket.fields.issuetype.name, status: ticket.fields.status.name, description: jiraDescriptionText(ticket.fields.description) };
}

function jiraDescriptionText(value: unknown): string {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";
  const node = value as { text?: unknown; content?: unknown };
  return `${typeof node.text === "string" ? node.text : ""}${Array.isArray(node.content) ? node.content.map(jiraDescriptionText).join("") : ""}`;
}

export interface MergeRequest { repository: string; number: number; title: string; branch: string; state: string; pipelineResult: "passed" | "failed" | "running"; jobsCompleted: number; jobsTotal: number; }
export interface CodeHost {
  listMergeRequests(branch: string): Promise<ReadonlyArray<MergeRequest>>;
  readPipeline(pipelineId: string): Promise<unknown | null>;
  readFile(branch: string, path: string): Promise<{ available: boolean; content: string | null }>;
  readDiffSummary(branch: string): Promise<{ available: boolean; filesChanged: number; linesAdded: number; linesRemoved: number }>;
  connectionStatus?(): Promise<WorkSourceConnection>;
  createBranch(branch: string): Promise<void>; push(branch: string): Promise<void>; openDraftMergeRequest(branch: string): Promise<void>;
  merge(): Promise<never>; markMergeRequestReady(): Promise<never>; deleteBranch(branch: string): Promise<void>;
}

function assertAdhisthanaBranch(branch: string): void { if (!isAdhisthanaBranch(branch)) throw new Error("code host writes require an Adhisthana branch"); }
function forbiddenWrite(action: string): never { throw new Error(`code host permanently refuses ${action}`); }

export interface GitLabMergeRequest { iid: number; title: string; source_branch: string; state: string; head_pipeline?: { status: string; detailed_status?: { details_path?: string } }; }
export interface GitLabTransport {
  listMergeRequests(input: { siteUrl: string; projectId: string; branch: string; token: string }): Promise<ReadonlyArray<GitLabMergeRequest>>;
  readPipeline(input: { siteUrl: string; projectId: string; pipelineId: string; token: string }): Promise<unknown | null>;
  readFile(input: { siteUrl: string; projectId: string; branch: string; path: string; token: string }): Promise<string | null>;
  readDiff(input: { siteUrl: string; projectId: string; baseBranch: string; branch: string; token: string }): Promise<string | null>;
}
export interface GitLabCodeHostOptions { siteUrl: string; projectId: string; credentialReference: string; credentialResolver: JiraCredentialResolver; defaultBranch: string; transport?: GitLabTransport; expiryWarningDays?: number; }
export class GitLabCodeHost implements CodeHost {
  constructor(private readonly options: GitLabCodeHostOptions, private readonly now: () => number = Date.now) {}
  async listMergeRequests(branch: string): Promise<ReadonlyArray<MergeRequest>> { const credential = await this.credential(); return (await this.transport.listMergeRequests({ siteUrl: this.options.siteUrl, projectId: this.options.projectId, branch, token: credential.value })).map((item) => ({ repository: this.options.projectId, number: item.iid, title: item.title, branch: item.source_branch, state: item.state, pipelineResult: pipelineResult(item.head_pipeline?.status), jobsCompleted: 0, jobsTotal: 0 })); }
  async readPipeline(pipelineId: string): Promise<unknown | null> { const credential = await this.credential(); return this.transport.readPipeline({ siteUrl: this.options.siteUrl, projectId: this.options.projectId, pipelineId, token: credential.value }); }
  async readFile(branch: string, path: string): Promise<{ available: boolean; content: string | null }> { const credential = await this.credential(); const content = await this.transport.readFile({ siteUrl: this.options.siteUrl, projectId: this.options.projectId, branch, path, token: credential.value }); return { available: content !== null, content }; }
  async readDiffSummary(branch: string): Promise<{ available: boolean; filesChanged: number; linesAdded: number; linesRemoved: number }> { const credential = await this.credential(); const diff = await this.transport.readDiff({ siteUrl: this.options.siteUrl, projectId: this.options.projectId, baseBranch: this.options.defaultBranch, branch, token: credential.value }); if (diff === null) return { available: false, filesChanged: 0, linesAdded: 0, linesRemoved: 0 }; return { available: true, filesChanged: diff.split("\n").filter((line) => line.startsWith("diff --git")).length, linesAdded: diff.split("\n").filter((line) => line.startsWith("+") && !line.startsWith("+++")).length, linesRemoved: diff.split("\n").filter((line) => line.startsWith("-") && !line.startsWith("---")).length }; }
  async connectionStatus(): Promise<WorkSourceConnection> { const credential = await this.credential(); await this.transport.listMergeRequests({ siteUrl: this.options.siteUrl, projectId: this.options.projectId, branch: this.options.defaultBranch, token: credential.value }); const expiresAt = credential.expiresAt ? Date.parse(credential.expiresAt) : Number.NaN; const daysUntilExpiry = Number.isFinite(expiresAt) ? Math.max(0, Math.ceil((expiresAt - this.now()) / 86_400_000)) : null; return { siteUrl: this.options.siteUrl, credentialReference: this.options.credentialReference, daysUntilExpiry, expiresSoon: daysUntilExpiry !== null && daysUntilExpiry <= (this.options.expiryWarningDays ?? 7) }; }
  private credential() { return this.options.credentialResolver.resolve(this.options.credentialReference); }
  private get transport(): GitLabTransport { return this.options.transport ?? new FetchGitLabTransport(); }
  async createBranch(branch: string): Promise<void> { assertAdhisthanaBranch(branch); }
  async push(branch: string): Promise<void> { assertAdhisthanaBranch(branch); }
  async openDraftMergeRequest(branch: string): Promise<void> { assertAdhisthanaBranch(branch); }
  async merge(): Promise<never> { return forbiddenWrite("merge"); }
  async markMergeRequestReady(): Promise<never> { return forbiddenWrite("marking a merge request ready"); }
  async deleteBranch(branch: string): Promise<void> { assertAdhisthanaBranch(branch); }
}
export class FetchGitLabTransport implements GitLabTransport {
  private async get(siteUrl: string, path: string, token: string): Promise<Response> { const response = await fetch(`${siteUrl.replace(/\/$/, "")}${path}`, { headers: { "PRIVATE-TOKEN": token, Accept: "application/json" } }); if (!response.ok && response.status !== 404) throw new Error(`GitLab read failed (${response.status})`); return response; }
  async listMergeRequests(input: { siteUrl: string; projectId: string; branch: string; token: string }): Promise<ReadonlyArray<GitLabMergeRequest>> { const response = await this.get(input.siteUrl, `/api/v4/projects/${encodeURIComponent(input.projectId)}/merge_requests?${new URLSearchParams({ source_branch: input.branch })}`, input.token); if (response.status === 404) throw new Error("GitLab project read failed (404)"); return await response.json() as GitLabMergeRequest[]; }
  async readPipeline(input: { siteUrl: string; projectId: string; pipelineId: string; token: string }): Promise<unknown | null> { const response = await this.get(input.siteUrl, `/api/v4/projects/${encodeURIComponent(input.projectId)}/pipelines/${encodeURIComponent(input.pipelineId)}`, input.token); return response.status === 404 ? null : await response.json(); }
  async readFile(input: { siteUrl: string; projectId: string; branch: string; path: string; token: string }): Promise<string | null> { const response = await this.get(input.siteUrl, `/api/v4/projects/${encodeURIComponent(input.projectId)}/repository/files/${encodeURIComponent(input.path)}?${new URLSearchParams({ ref: input.branch })}`, input.token); if (response.status === 404) return null; const body = await response.json() as { content?: string }; return body.content ? Buffer.from(body.content, "base64").toString("utf8") : null; }
  async readDiff(input: { siteUrl: string; projectId: string; baseBranch: string; branch: string; token: string }): Promise<string | null> { const response = await this.get(input.siteUrl, `/api/v4/projects/${encodeURIComponent(input.projectId)}/repository/compare?${new URLSearchParams({ from: input.baseBranch, to: input.branch })}`, input.token); if (response.status === 404) return null; const body = await response.json() as { diffs?: Array<{ diff: string }> }; return body.diffs?.map((item) => item.diff).join("\n") ?? null; }
}
function pipelineResult(status: string | undefined): MergeRequest["pipelineResult"] { return status === "success" ? "passed" : status === "failed" ? "failed" : "running"; }

export class NullWorkSource implements WorkSource {
  async listAssignedTickets(): Promise<ReadonlyArray<WorkSourceTicket>> { return []; }
  async readTicket(_ticketKey: string): Promise<WorkSourceTicket | null> { return null; }
}

export class FakeWorkSource implements WorkSource {
  private readonly tickets: ReadonlyArray<WorkSourceTicket> = [
    { key: "OPS-101", title: "Repair payroll export", type: "bug", status: "open", description: "Exports time out for large teams." },
    { key: "OPS-102", title: "Add audit retention", type: "feature", status: "open", description: "Retain approval decisions." }
  ];
  async listAssignedTickets(): Promise<ReadonlyArray<WorkSourceTicket>> { return this.tickets; }
  async readTicket(ticketKey: string): Promise<WorkSourceTicket | null> { return this.tickets.find((ticket) => ticket.key === ticketKey) ?? null; }
}

export class NullCodeHost implements CodeHost {
  async listMergeRequests(_branch: string): Promise<ReadonlyArray<MergeRequest>> { return []; }
  async readPipeline(_pipelineId: string): Promise<unknown | null> { return null; }
  async readFile(_branch: string, _path: string): Promise<{ available: boolean; content: string | null }> { return { available: false, content: null }; }
  async readDiffSummary(_branch: string): Promise<{ available: boolean; filesChanged: number; linesAdded: number; linesRemoved: number }> { return { available: false, filesChanged: 0, linesAdded: 0, linesRemoved: 0 }; }
  async createBranch(branch: string): Promise<void> { assertAdhisthanaBranch(branch); } async push(branch: string): Promise<void> { assertAdhisthanaBranch(branch); } async openDraftMergeRequest(branch: string): Promise<void> { assertAdhisthanaBranch(branch); }
  async merge(): Promise<never> { return forbiddenWrite("merge"); } async markMergeRequestReady(): Promise<never> { return forbiddenWrite("marking a merge request ready"); } async deleteBranch(branch: string): Promise<void> { assertAdhisthanaBranch(branch); }
}

export class FakeCodeHost implements CodeHost {
  async listMergeRequests(branch: string): Promise<ReadonlyArray<MergeRequest>> { return branch ? [{ repository: "payroll-api", number: 42, title: "Repair export batching", branch, state: "opened", pipelineResult: "running", jobsCompleted: 3, jobsTotal: 5 }] : []; }
  async readPipeline(_pipelineId: string): Promise<unknown | null> { return null; }
  async readFile(branch: string, path: string): Promise<{ available: boolean; content: string | null }> { return { available: true, content: `# ${path}\n\nPreview from ${branch}.` }; }
  async readDiffSummary(_branch: string): Promise<{ available: boolean; filesChanged: number; linesAdded: number; linesRemoved: number }> { return { available: true, filesChanged: 4, linesAdded: 26, linesRemoved: 8 }; }
  async createBranch(branch: string): Promise<void> { assertAdhisthanaBranch(branch); } async push(branch: string): Promise<void> { assertAdhisthanaBranch(branch); } async openDraftMergeRequest(branch: string): Promise<void> { assertAdhisthanaBranch(branch); }
  async merge(): Promise<never> { return forbiddenWrite("merge"); } async markMergeRequestReady(): Promise<never> { return forbiddenWrite("marking a merge request ready"); } async deleteBranch(branch: string): Promise<void> { assertAdhisthanaBranch(branch); }
}

export class ConnectorConfigurator {
  private readonly workSources = new Map<string, WorkSource>();
  private readonly codeHosts = new Map<string, CodeHost>();
  private readonly nullWorkSource = new NullWorkSource();
  private readonly nullCodeHost = new NullCodeHost();
  registerWorkSource(kind: string, source: WorkSource): void { this.workSources.set(kind, source); }
  registerCodeHost(kind: string, host: CodeHost): void { this.codeHosts.set(kind, host); }
  resolveWorkSource(kind: string): WorkSource { const source = this.workSources.get(kind); if (!source) console.warn(`ConnectorConfigurator: work source \"${kind}\" is not registered; using null fallback.`); return source ?? this.nullWorkSource; }
  resolveCodeHost(kind: string): CodeHost { const host = this.codeHosts.get(kind); if (!host) console.warn(`ConnectorConfigurator: code host \"${kind}\" is not registered; using null fallback.`); return host ?? this.nullCodeHost; }
  getWorkSourceFallback(): WorkSource { return this.nullWorkSource; }
  getCodeHostFallback(): CodeHost { return this.nullCodeHost; }
}

export class ConnectorManager {
  constructor(private readonly configurator: ConnectorConfigurator, private readonly workSourceKind: string, private readonly codeHostKind: string) {}
  getWorkSource(): WorkSource { return this.configurator.resolveWorkSource(this.workSourceKind); }
  getCodeHost(): CodeHost { return this.configurator.resolveCodeHost(this.codeHostKind); }
}
