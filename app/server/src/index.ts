import cors from "@fastify/cors";
import { spawn } from "node:child_process";
import { AgentConfigurator, AgentManager, ClaudeCodeAgent, CodexAgent, EngineRegistry, HermesAgent } from "@aios/agents";
import { buildApp } from "./app.js";
import { registerInstalledConsoleFiles } from "./InstalledConsole.js";

const configurator = new AgentConfigurator();
const hermesAgent = new HermesAgent();
configurator.register("hermes", hermesAgent);

// checkHealth() alone would always report optimistic-healthy on this first
// call (see HermesAgent's cached-health design) -- warm it up with a real,
// awaited check first so AgentManager's fallback-on-unhealthy logic can
// actually see reality on a cold start, not just the optimistic default.
await hermesAgent.warmUpHealth();

const engineRegistry = new EngineRegistry();
engineRegistry.register("hermes", (route) => new HermesAgent(undefined, route));
engineRegistry.register("codex", (route, context) => new CodexAgent(route, { agentId: context.agentId }));
engineRegistry.register("claude-code", (route, context) => new ClaudeCodeAgent(route, { agentId: context.agentId }));

const manager = new AgentManager(configurator, "hermes", engineRegistry);

const app = buildApp(manager);
await app.register(cors, { origin: true });
if (process.env.AIOS_CLIENT_DIR) registerInstalledConsoleFiles(app, process.env.AIOS_CLIENT_DIR);

const port = Number(process.env.PORT ?? 3001);
app.listen({ port }, (err, address) => {
  if (err) {
    app.log.error(err);
    process.exit(1);
  }
  app.log.info(`Adhiṣṭhāna BFF listening on ${address}`);
  if (process.env.AIOS_OPEN_BROWSER === "1") openConsole(address);
});

function openConsole(address: string): void {
  const command = process.platform === "win32" ? "cmd.exe" : process.platform === "darwin" ? "open" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", address] : [address];
  const browser = spawn(command, args, { detached: true, stdio: "ignore" });
  browser.unref();
}
