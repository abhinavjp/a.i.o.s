export interface WorkSourceTicket { key: string; title: string; type: string; status: string; description: string; }
export interface WorkSource {
  listAssignedTickets(): Promise<ReadonlyArray<WorkSourceTicket>>;
  readTicket(ticketKey: string): Promise<WorkSourceTicket | null>;
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
