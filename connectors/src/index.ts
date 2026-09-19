export interface WorkSource {
  listAssignedTickets(): Promise<ReadonlyArray<unknown>>;
  readTicket(ticketKey: string): Promise<unknown | null>;
}

export interface CodeHost {
  listMergeRequests(branch: string): Promise<ReadonlyArray<unknown>>;
  readPipeline(pipelineId: string): Promise<unknown | null>;
  readFile(branch: string, path: string): Promise<{ available: boolean; content: string | null }>;
}

export class NullWorkSource implements WorkSource {
  async listAssignedTickets(): Promise<ReadonlyArray<unknown>> { return []; }
  async readTicket(_ticketKey: string): Promise<unknown | null> { return null; }
}

export class NullCodeHost implements CodeHost {
  async listMergeRequests(_branch: string): Promise<ReadonlyArray<unknown>> { return []; }
  async readPipeline(_pipelineId: string): Promise<unknown | null> { return null; }
  async readFile(_branch: string, _path: string): Promise<{ available: boolean; content: string | null }> { return { available: false, content: null }; }
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
