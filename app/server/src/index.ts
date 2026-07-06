import cors from "@fastify/cors";
import { AgentConfigurator, AgentManager, FakeAgent } from "@aios/agents";
import { buildApp } from "./app.js";

const configurator = new AgentConfigurator();
configurator.register("fake", new FakeAgent());

const manager = new AgentManager(configurator, "fake");

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
