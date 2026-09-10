import type { AgentAbstraction, AgentInfo, EngineReadiness, EngineRoute, HealthStatus, OrchestratorCapability, TaskStream } from "@aios/contracts";
import { NativeProcessRunner, type NativeProcessRunnerPort } from "../native/NativeProcessRunner.js";
import { readinessFromHealth } from "../EngineReadiness.js";

export interface ClaudeCodeAgentOptions { runner?: NativeProcessRunnerPort; workingRoot?: string; permissionMode?: string; configRoot?: string }

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
    this.configRoot = options.configRoot ?? `${process.cwd()}\\.data\\engine-sessions\\claude-code\\${route.configuration}`;
  }
  private readonly configRoot: string;
  getInfo(): AgentInfo { return { id: "claude-code", kind: "claude-code", displayName: "Claude Code" }; }
  checkHealth(): HealthStatus { return this.cachedHealth; }
  async checkReadiness(): Promise<EngineReadiness> {
    const ok = await this.runner.check("claude", ["--version"], { cwd: this.workingRoot });
    this.cachedHealth = ok ? { ok: true } : { ok: false, reason: "Claude Code executable or authentication is unavailable" };
    return readinessFromHealth(this.cachedHealth);
  }
  getNativeSessionId(): string | undefined { return this.nativeSessionId; }

  runTask(task: string): TaskStream {
    const argv = ["--print", "--output-format", "stream-json", "--verbose", "--settings", this.route.configuration, "--permission-mode", this.permissionMode, ...(this.nativeSessionId ? ["--resume", this.nativeSessionId] : ["--session-id", "sarathi-session"]), task];
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

function normalizeEvent(line: string): { text?: string; sessionId?: string } {
  let event: unknown;
  try { event = JSON.parse(line); } catch { throw new Error("Claude Code returned a malformed JSON event"); }
  if (!event || typeof event !== "object" || Array.isArray(event)) throw new Error("Claude Code returned a malformed JSON event");
  const value = event as Record<string, unknown>;
  const sessionId = typeof value.session_id === "string" ? value.session_id : undefined;
  const text = typeof value.text === "string" ? value.text : typeof value.result === "string" ? value.result : undefined;
  return { text, sessionId };
}
