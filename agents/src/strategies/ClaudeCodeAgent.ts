import type { AgentAbstraction, AgentInfo, EngineReadiness, EngineRoute, HealthStatus, OrchestratorCapability, TaskStream } from "@aios/contracts";
import { NativeProcessRunner, type NativeProcessRunnerPort } from "../native/NativeProcessRunner.js";
import { readinessFromHealth } from "../EngineReadiness.js";
import { randomUUID } from "node:crypto";

export interface ClaudeCodeAgentOptions { runner?: NativeProcessRunnerPort; workingRoot?: string; permissionMode?: string; configRoot?: string; agentId?: string; readinessProbe?: () => Promise<EngineReadiness> }

export class ClaudeCodeAgent implements AgentAbstraction {
  private readonly runner: NativeProcessRunnerPort;
  private nativeSessionId: string | undefined;
  private cachedHealth: HealthStatus = { ok: false, reason: "Claude Code readiness is UNMEASURED" };
  private readonly workingRoot: string;
  private readonly permissionMode: string;
  // Only set when explicitly requested: an isolated CLAUDE_CONFIG_DIR has no
  // subscription login, so by default the user's own `claude` login is used.
  private readonly configRoot: string | undefined;
  private readonly readinessProbe?: () => Promise<EngineReadiness>;
  private readonly initialSessionId = randomUUID();

  constructor(private readonly route: EngineRoute, options: ClaudeCodeAgentOptions = {}) {
    this.runner = options.runner ?? new NativeProcessRunner();
    this.workingRoot = options.workingRoot ?? process.cwd();
    this.permissionMode = options.permissionMode ?? "default";
    this.configRoot = options.configRoot;
    this.readinessProbe = options.readinessProbe;
  }
  getInfo(): AgentInfo { return { id: "claude-code", kind: "claude-code", displayName: "Claude Code" }; }
  checkHealth(): HealthStatus { return this.cachedHealth; }
  async checkReadiness(): Promise<EngineReadiness> {
    const ok = await this.runner.check("claude", ["--version"], this.spawnOptions());
    if (!ok) {
      this.cachedHealth = { ok: false, reason: "Claude Code executable is unavailable" };
      return readinessFromHealth(this.cachedHealth);
    }
    const readiness = this.readinessProbe ? await this.readinessProbe() : await this.probeAuthentication();
    this.cachedHealth = readiness.state === "ready" ? { ok: true } : { ok: false, reason: readiness.reason };
    return readiness;
  }
  getNativeSessionId(): string | undefined { return this.nativeSessionId; }

  runTask(task: string): TaskStream {
    const model = this.route.model ? ["--model", this.route.model] : [];
    const settings = isSettingsFile(this.route.configuration) ? ["--settings", this.route.configuration] : [];
    const argv = ["--print", "--output-format", "stream-json", "--verbose", ...settings, "--permission-mode", this.permissionMode, ...model, ...(this.nativeSessionId ? ["--resume", this.nativeSessionId] : ["--session-id", this.initialSessionId]), task];
    const runner = this.runner;
    return (async function* (owner: ClaudeCodeAgent): TaskStream {
      const execution = runner.spawn("claude", argv, owner.spawnOptions());
      try {
        for await (const line of execution.lines) {
          const event = normalizeEvent(line);
          if (event.sessionId) owner.nativeSessionId = event.sessionId;
          if (event.error) throw new Error(`Claude Code failed: ${event.error}`);
          if (event.text) yield event.text;
        }
        const result = await execution.result;
        if (result.nativeSessionId && !owner.nativeSessionId) owner.nativeSessionId = result.nativeSessionId;
        if (result.output) yield result.output;
      } finally { execution.cancel(); }
    })(this);
  }
  asOrchestrator(): OrchestratorCapability | null { return null; }

  private async probeAuthentication(): Promise<EngineReadiness> {
    const loggedIn = await this.runner.check("claude", ["auth", "status"], this.spawnOptions());
    return loggedIn
      ? { state: "ready", reason: "Claude Code is installed and authenticated (claude auth status)", checkedAt: new Date().toISOString() }
      : { state: "unavailable", reason: "Claude Code is not logged in. Run `claude auth login` in a terminal, then retry.", checkedAt: new Date().toISOString() };
  }

  private spawnOptions() {
    const env = this.configRoot ? { ...process.env, CLAUDE_CONFIG_DIR: this.configRoot } : { ...process.env };
    // `claude --print` waits on an open stdin; the prompt is passed via argv.
    return { cwd: this.workingRoot, env, stdio: ["ignore", "pipe", "pipe"] as ["ignore", "pipe", "pipe"] };
  }
}

function isSettingsFile(configuration: string): boolean {
  return /\.json$/i.test(configuration.trim()) || configuration.trim().startsWith("{");
}

function normalizeEvent(line: string): { text?: string; sessionId?: string; error?: string } {
  let event: unknown;
  try { event = JSON.parse(line); } catch { throw new Error("Claude Code returned a malformed JSON event"); }
  if (!event || typeof event !== "object" || Array.isArray(event)) throw new Error("Claude Code returned a malformed JSON event");
  const value = event as Record<string, unknown>;
  const sessionId = typeof value.session_id === "string" ? value.session_id : undefined;
  if (value.type === "result" && value.is_error === true) {
    return { sessionId, error: typeof value.result === "string" ? value.result : "unknown error" };
  }
  const text = typeof value.text === "string" ? value.text : typeof value.result === "string" ? value.result : undefined;
  return { text, sessionId };
}
