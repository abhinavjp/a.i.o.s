import { generateKeyPairSync, sign } from "node:crypto";
import { createHash } from "node:crypto";
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

  test("keeps an approved update ask when the normal app has no installer", async () => {
    const app = createTestApp(manager(), {
      releaseChannelStore: new MemoryReleaseChannelStore(), releaseChannelPublicKey: publicKey,
      releaseChannelTransport: { async fetch() { return JSON.stringify(signedManifest); } }
    });
    await app.inject({ method: "POST", url: "/api/release-channel/check" });
    const ask = (await app.inject({ method: "GET", url: "/api/sarathi/asks" })).json().asks[0];

    const response = await app.inject({ method: "POST", url: `/api/sarathi/asks/${ask.id}/decide`, payload: { decision: "approved" } });

    expect(response.statusCode).toBe(500);
    expect(response.json().message).toBe("system update execution is not configured");
    expect((await app.inject({ method: "GET", url: "/api/sarathi/asks" })).json().asks).toEqual([expect.objectContaining({ id: ask.id })]);
  });

  test("installs a checksum-verified approved update without passing the user state directory", async () => {
    const artifact = Buffer.from("release artifact");
    const checkedRelease = { ...release, checksum: createHash("sha256").update(artifact).digest("hex") };
    const checked = { channel: "public", releases: [checkedRelease] };
    const checkedManifest = { ...checked, signature: sign(null, Buffer.from(JSON.stringify(checked)), keys.privateKey).toString("base64") };
    const installs: Array<{ version: string; artifact: Buffer }> = [];
    const app = createTestApp(manager(), { releaseChannelStore: new MemoryReleaseChannelStore(), releaseChannelPublicKey: publicKey, releaseChannelTransport: { async fetch() { return JSON.stringify(checkedManifest); } }, updateInstaller: { async download() { return artifact; }, async install(input) { installs.push(input); }, async rollback() { throw new Error("no retained previous version is available"); } } });
    await app.inject({ method: "POST", url: "/api/release-channel/check" });
    const ask = (await app.inject({ method: "GET", url: "/api/sarathi/asks" })).json().asks[0];
    expect((await app.inject({ method: "POST", url: `/api/sarathi/asks/${ask.id}/decide`, payload: { decision: "approved" } })).statusCode).toBe(200);
    expect(installs).toEqual([{ version: "0.1.0", artifact, retainPrevious: true }]);
    expect((await app.inject({ method: "GET", url: "/api/update-audit" })).json().entries).toEqual([expect.objectContaining({ version: "0.1.0", channel: "public", appliedAt: expect.any(String) })]);
  });

  test("does not install when an approved update checksum is wrong", async () => {
    const installs: unknown[] = [];
    const app = createTestApp(manager(), { releaseChannelStore: new MemoryReleaseChannelStore(), releaseChannelPublicKey: publicKey, releaseChannelTransport: { async fetch() { return JSON.stringify(signedManifest); } }, updateInstaller: { async download() { return Buffer.from("wrong artifact"); }, async install(input) { installs.push(input); }, async rollback() { throw new Error("no retained previous version is available"); } } });
    await app.inject({ method: "POST", url: "/api/release-channel/check" });
    const ask = (await app.inject({ method: "GET", url: "/api/sarathi/asks" })).json().asks[0];
    const response = await app.inject({ method: "POST", url: `/api/sarathi/asks/${ask.id}/decide`, payload: { decision: "approved" } });
    expect(response.statusCode).toBe(500);
    expect(response.json().message).toBe("update checksum does not match");
    expect(installs).toEqual([]);
    expect((await app.inject({ method: "GET", url: "/api/sarathi/asks" })).json().asks).toEqual([expect.objectContaining({ id: ask.id })]);
  });

  test("rolls back the retained version, reports it as running, and audits both versions", async () => {
    const artifact = Buffer.from("release artifact");
    const checkedRelease = { ...release, checksum: createHash("sha256").update(artifact).digest("hex") };
    const checked = { channel: "public", releases: [checkedRelease] };
    const checkedManifest = { ...checked, signature: sign(null, Buffer.from(JSON.stringify(checked)), keys.privateKey).toString("base64") };
    const rollbacks: string[] = [];
    const app = createTestApp(manager(), { releaseChannelStore: new MemoryReleaseChannelStore(), releaseChannelPublicKey: publicKey, releaseChannelTransport: { async fetch() { return JSON.stringify(checkedManifest); } }, updateInstaller: { async download() { return artifact; }, async install() {}, async rollback() { rollbacks.push("rollback"); return { version: "0.0.0" }; } } });
    await app.inject({ method: "POST", url: "/api/release-channel/check" });
    const ask = (await app.inject({ method: "GET", url: "/api/sarathi/asks" })).json().asks[0];
    await app.inject({ method: "POST", url: `/api/sarathi/asks/${ask.id}/decide`, payload: { decision: "approved" } });

    expect((await app.inject({ method: "POST", url: "/api/update/rollback" })).statusCode).toBe(200);
    expect(rollbacks).toEqual(["rollback"]);
    expect((await app.inject({ method: "GET", url: "/api/version" })).json()).toEqual({ version: "0.0.0" });
    expect((await app.inject({ method: "GET", url: "/api/update-audit" })).json().entries.at(-1)).toEqual(expect.objectContaining({ action: "rollback", version: "0.0.0", previousVersion: "0.1.0", appliedAt: expect.any(String) }));
  });

  test("rejects rollback when no previous version is retained", async () => {
    const app = createTestApp(manager(), { updateInstaller: { async download() { return Buffer.alloc(0); }, async install() {}, async rollback() { throw new Error("no retained previous version is available"); } } });

    const response = await app.inject({ method: "POST", url: "/api/update/rollback" });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: "no retained previous version is available" });
  });
});
