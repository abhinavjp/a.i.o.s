import type { AgentAbstraction, AgentInfo, EngineReadiness, EngineRoute, HealthStatus, OrchestratorCapability, TaskStream } from "@aios/contracts";
import { NativeProcessRunner, type NativeProcessRunnerPort } from "../native/NativeProcessRunner.js";
import { readinessFromHealth } from "../EngineReadiness.js";
import { join } from "node:path";
import { createHash } from "node:crypto";

export interface CodexAgentOptions { runner?: NativeProcessRunnerPort; workingRoot?: string; sandbox?: string; configRoot?: string; agentId?: string; readinessProbe?: () => Promise<EngineReadiness> }

export class CodexAgent implements AgentAbstraction {
  private readonly runner: NativeProcessRunnerPort;
  private nativeSessionId: string | undefined;
  private cachedHealth: HealthStatus = { ok: false, reason: "Codex readiness is UNMEASURED" };

  constructor(private readonly route: EngineRoute, options: CodexAgentOptions = {}) {
    this.runner = options.runner ?? new NativeProcessRunner();
    this.workingRoot = options.workingRoot ?? process.cwd();
    this.sandbox = options.sandbox ?? "workspace-write";
    this.configRoot = options.configRoot ?? join(process.cwd(), ".data", "engine-sessions", "codex", safeSegment(options.agentId ?? "active-agent"), safeSegment(route.configuration));
    this.readinessProbe = options.readinessProbe;
  }
  private readonly workingRoot: string;
  private readonly sandbox: string;
  private readonly configRoot: string;
  private readonly readinessProbe?: () => Promise<EngineReadiness>;

  getInfo(): AgentInfo { return { id: "codex", kind: "codex", displayName: "Codex" }; }
  checkHealth(): HealthStatus { return this.cachedHealth; }
  async checkReadiness(): Promise<EngineReadiness> {
    const ok = await this.runner.check("codex", ["--version"], { cwd: this.workingRoot });
    if (!ok) {
      this.cachedHealth = { ok: false, reason: "codex executable is unavailable" };
      return readinessFromHealth(this.cachedHealth);
    }
    const readiness = this.readinessProbe
      ? await this.readinessProbe()
      : { state: "unmeasured", reason: "Codex executable found; authenticated readiness proof is UNMEASURED", checkedAt: new Date().toISOString() } as const;
    this.cachedHealth = readiness.state === "ready" ? { ok: true } : { ok: false, reason: readiness.reason };
    return readiness;
  }
  getNativeSessionId(): string | undefined { return this.nativeSessionId; }

  runTask(task: string): TaskStream {
    const model = this.route.model ? ["-m", this.route.model] : [];
    const argv = this.nativeSessionId
      ? ["exec", "resume", this.nativeSessionId, "--json", "--profile", this.route.configuration, ...model, "--sandbox", this.sandbox, "--cd", this.workingRoot, task]
      : ["exec", "--json", "--profile", this.route.configuration, ...model, "--sandbox", this.sandbox, "--cd", this.workingRoot, task];
    const runner = this.runner;
    return (async function* (owner: CodexAgent): TaskStream {
      const execution = runner.spawn("codex", argv, { cwd: owner.workingRoot, env: { ...process.env, CODEX_HOME: owner.configRoot } });
      try {
        for await (const line of execution.lines) {
          const event = normalizeEvent(line);
          if (event.sessionId) owner.nativeSessionId = event.sessionId;
          if (event.text) yield event.text;
        }
        const result = await execution.result;
        if (result.nativeSessionId && !owner.nativeSessionId) owner.nativeSessionId = result.nativeSessionId;
        if (result.output) yield result.output;
      } finally { execution.cancel(); }
    })(this);
  }
  asOrchestrator(): OrchestratorCapability | null { return null; }
}

function safeSegment(value: string): string {
  const normalized = value.trim() || "default";
  const readable = normalized.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 40) || "value";
  return `${readable}-${createHash("sha256").update(normalized).digest("hex").slice(0, 12)}`;
}

function normalizeEvent(line: string): { text?: string; sessionId?: string } {
  let event: unknown;
  try { event = JSON.parse(line); } catch { throw new Error("codex returned a malformed JSON event"); }
  if (!event || typeof event !== "object" || Array.isArray(event)) throw new Error("codex returned a malformed JSON event");
  const value = event as Record<string, unknown>;
  const sessionId = typeof value.session_id === "string" ? value.session_id : typeof value.thread_id === "string" ? value.thread_id : undefined;
  const item = value.item as Record<string, unknown> | undefined;
  const text = value.type === "item.completed" && item?.type === "agent_message" && typeof item.text === "string"
    ? item.text : typeof value.text === "string" ? value.text : typeof value.output === "string" ? value.output : undefined;
  return { text, sessionId };
}
