import type { AgentAbstraction, AgentInfo, EngineReadiness, EngineRoute, HealthStatus, OrchestratorCapability, TaskStream } from "@aios/contracts";
import { NativeProcessRunner, type NativeProcessRunnerPort } from "../native/NativeProcessRunner.js";
import { readinessFromHealth } from "../EngineReadiness.js";
import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";

export interface ClaudeCodeAgentOptions { runner?: NativeProcessRunnerPort; workingRoot?: string; permissionMode?: string; configRoot?: string; agentId?: string; readinessProbe?: () => Promise<EngineReadiness> }

export class ClaudeCodeAgent implements AgentAbstraction {
  private readonly runner: NativeProcessRunnerPort;
  private nativeSessionId: string | undefined;
  private cachedHealth: HealthStatus = { ok: false, reason: "Claude Code readiness is UNMEASURED" };
  private readonly workingRoot: string;
  private readonly permissionMode: string;

  constructor(private readonly route: EngineRoute, options: ClaudeCodeAgentOptions = {}) {
    this.runner = options.runner ?? new NativeProcessRunner();
    this.workingRoot = options.workingRoot ?? process.cwd();
    this.permissionMode = options.permissionMode ?? "default";
    this.configRoot = options.configRoot ?? join(process.cwd(), ".data", "engine-sessions", "claude-code", safeSegment(options.agentId ?? "active-agent"), safeSegment(route.configuration));
    this.readinessProbe = options.readinessProbe;
  }
  private readonly configRoot: string;
  private readonly readinessProbe?: () => Promise<EngineReadiness>;
  private readonly initialSessionId = randomUUID();
  getInfo(): AgentInfo { return { id: "claude-code", kind: "claude-code", displayName: "Claude Code" }; }
  checkHealth(): HealthStatus { return this.cachedHealth; }
  async checkReadiness(): Promise<EngineReadiness> {
    const ok = await this.runner.check("claude", ["--version"], { cwd: this.workingRoot });
    if (!ok) {
      this.cachedHealth = { ok: false, reason: "Claude Code executable is unavailable" };
      return readinessFromHealth(this.cachedHealth);
    }
    const readiness = this.readinessProbe
      ? await this.readinessProbe()
      : { state: "unmeasured", reason: "Claude Code executable found; authenticated readiness proof is UNMEASURED", checkedAt: new Date().toISOString() } as const;
    this.cachedHealth = readiness.state === "ready" ? { ok: true } : { ok: false, reason: readiness.reason };
    return readiness;
  }
  getNativeSessionId(): string | undefined { return this.nativeSessionId; }

  runTask(task: string): TaskStream {
    const model = this.route.model ? ["--model", this.route.model] : [];
    const argv = ["--print", "--output-format", "stream-json", "--verbose", "--settings", this.route.configuration, "--permission-mode", this.permissionMode, ...model, ...(this.nativeSessionId ? ["--resume", this.nativeSessionId] : ["--session-id", this.initialSessionId]), task];
    const runner = this.runner;
    return (async function* (owner: ClaudeCodeAgent): TaskStream {
      const execution = runner.spawn("claude", argv, { cwd: owner.workingRoot, env: { ...process.env, CLAUDE_CONFIG_DIR: owner.configRoot } });
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
  try { event = JSON.parse(line); } catch { throw new Error("Claude Code returned a malformed JSON event"); }
  if (!event || typeof event !== "object" || Array.isArray(event)) throw new Error("Claude Code returned a malformed JSON event");
  const value = event as Record<string, unknown>;
  const sessionId = typeof value.session_id === "string" ? value.session_id : undefined;
  const text = typeof value.text === "string" ? value.text : typeof value.result === "string" ? value.result : undefined;
  return { text, sessionId };
}
