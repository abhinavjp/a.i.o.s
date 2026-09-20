import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, test } from "vitest";
import { AgentConfigurator, AgentManager, FakeAgent } from "@aios/agents";
import { createTestApp } from "./testApp.js";
import { MemoryReleaseChannelStore } from "../src/ReleaseChannel.js";

const keys = generateKeyPairSync("ed25519");
const publicKey = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
const release = { version: "0.1.0", download: "https://updates.example/0.1.0.tgz", checksum: "abc", notes: "Important fixes" };
const manifest = { channel: "public", releases: [release] };
const signedManifest = { ...manifest, signature: sign(null, Buffer.from(JSON.stringify(manifest)), keys.privateKey).toString("base64") };

function manager() {
  const configurator = new AgentConfigurator(); configurator.register("fake", new FakeAgent());
  return new AgentManager(configurator, "fake");
}

describe("available updates", () => {
  test("creates one floor ask with release details that only the user can decide", async () => {
    const app = createTestApp(manager(), {
      releaseChannelStore: new MemoryReleaseChannelStore(), releaseChannelPublicKey: publicKey,
      releaseChannelTransport: { async fetch() { return JSON.stringify(signedManifest); } },
      permissionTools: { definitions: [{ tool: "work", operations: ["question"] }, { tool: "system-update", operations: ["apply"] }], async execute() { return { output: "done" }; }, isUndoable() { return true; }, async undo() {} }
    });
    await app.inject({ method: "PUT", url: "/api/sarathi/autopilot", payload: { low: "automatic", medium: "automatic", high: "automatic" } });
    expect((await app.inject({ method: "POST", url: "/api/sarathi/standing-rules", payload: { label: "All questions", askKind: "question", scope: "all" } })).statusCode).toBe(201);
    expect((await app.inject({ method: "POST", url: "/api/sarathi/standing-rules", payload: { label: "Apply updates", askKind: "apply", scope: "all" } })).statusCode).toBe(400);

    expect((await app.inject({ method: "POST", url: "/api/release-channel/check" })).json()).toEqual(expect.objectContaining({ status: "available", release }));
    const asks = (await app.inject({ method: "GET", url: "/api/sarathi/asks" })).json().asks;
    expect(asks).toHaveLength(1);
    expect(asks[0]).toEqual(expect.objectContaining({ kind: "apply", intent: { tool: "system-update", operation: "apply", target: "installation", context: { version: release.version, channel: "public", notes: release.notes, download: release.download, checksum: release.checksum } } }));

    await app.inject({ method: "POST", url: "/api/release-channel/check" });
    expect((await app.inject({ method: "GET", url: "/api/sarathi/asks" })).json().asks).toHaveLength(1);
    expect((await app.inject({ method: "POST", url: `/api/sarathi/asks/${asks[0].id}/decide`, payload: { decision: "declined" } })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/api/version" })).json()).toEqual({ version: "0.0.0" });
  });

  test("uses the normal app decision engine when no tool executor is injected", async () => {
    const app = createTestApp(manager(), {
      releaseChannelStore: new MemoryReleaseChannelStore(), releaseChannelPublicKey: publicKey,
      releaseChannelTransport: { async fetch() { return JSON.stringify(signedManifest); } }
    });
    await app.inject({ method: "POST", url: "/api/release-channel/check" });
    expect((await app.inject({ method: "GET", url: "/api/sarathi/asks" })).json().asks).toEqual([expect.objectContaining({ intent: expect.objectContaining({ tool: "system-update", operation: "apply" }) })]);
  });
});
