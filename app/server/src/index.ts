import cors from "@fastify/cors";
import { AgentConfigurator, AgentManager, HermesAgent } from "@aios/agents";
import { buildApp } from "./app.js";

const configurator = new AgentConfigurator();
const hermesAgent = new HermesAgent();
configurator.register("hermes", hermesAgent);

// checkHealth() alone would always report optimistic-healthy on this first
// call (see HermesAgent's cached-health design) -- warm it up with a real,
// awaited check first so AgentManager's fallback-on-unhealthy logic can
// actually see reality on a cold start, not just the optimistic default.
await hermesAgent.warmUpHealth();

const manager = new AgentManager(configurator, "hermes");

const app = buildApp(manager);
await app.register(cors, { origin: true });

const port = Number(process.env.PORT ?? 3001);
app.listen({ port }, (err, address) => {
  if (err) {
    app.log.error(err);
    process.exit(1);
  }
  app.log.info(`Adhiṣṭhāna BFF listening on ${address}`);
});
