export interface WorkSourceTicket { key: string; title: string; type: string; status: string; description: string; }
export interface WorkSourceConnection { siteUrl: string; credentialReference: string; daysUntilExpiry: number | null; expiresSoon: boolean; }
export interface WorkSource {
  listAssignedTickets(): Promise<ReadonlyArray<WorkSourceTicket>>;
  readTicket(ticketKey: string): Promise<WorkSourceTicket | null>;
  connectionStatus?(): Promise<WorkSourceConnection>;
}

export interface JiraIssue { key: string; fields: { summary: string; issuetype: { name: string }; status: { name: string }; description: unknown; }; }
export interface JiraCredentialResolver { resolve(reference: string): Promise<{ value: string; expiresAt?: string }>; }
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
}

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
}

export class FakeCodeHost implements CodeHost {
  async listMergeRequests(branch: string): Promise<ReadonlyArray<MergeRequest>> { return branch ? [{ repository: "payroll-api", number: 42, title: "Repair export batching", branch, state: "opened", pipelineResult: "running", jobsCompleted: 3, jobsTotal: 5 }] : []; }
  async readPipeline(_pipelineId: string): Promise<unknown | null> { return null; }
  async readFile(branch: string, path: string): Promise<{ available: boolean; content: string | null }> { return { available: true, content: `# ${path}\n\nPreview from ${branch}.` }; }
  async readDiffSummary(_branch: string): Promise<{ available: boolean; filesChanged: number; linesAdded: number; linesRemoved: number }> { return { available: true, filesChanged: 4, linesAdded: 26, linesRemoved: 8 }; }
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
