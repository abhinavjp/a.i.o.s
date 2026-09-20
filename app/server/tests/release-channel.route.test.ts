import { generateKeyPairSync, sign } from "node:crypto";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { AgentConfigurator, AgentManager, FakeAgent } from "@aios/agents";
import { createTestApp } from "./testApp.js";
import { FetchReleaseChannelTransport, FileReleaseChannelStore, MemoryReleaseChannelStore } from "../src/ReleaseChannel.js";

const runningVersion = "0.0.0";
const keys = generateKeyPairSync("ed25519");
const publicKey = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
const releases = (version: string) => [{ version, download: `https://updates.example/${version}.tgz`, checksum: "abc", notes: "Release notes" }];
const signed = (channel: string, availableReleases: ReturnType<typeof releases>) => ({
  channel,
  releases: availableReleases,
  signature: sign(null, Buffer.from(JSON.stringify({ channel, releases: availableReleases })), keys.privateKey).toString("base64")
});

function manager() {
  const configurator = new AgentConfigurator();
  configurator.register("fake", new FakeAgent());
  return new AgentManager(configurator, "fake");
}

describe("release channel", () => {
  test("sends only the running version and channel as update metadata", async () => {
    let headers: Record<string, string | string[] | undefined> | undefined;
    const server = createServer((request, response) => {
      headers = request.headers;
      response.end("{}");
    });
    server.listen();
    await once(server, "listening");
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("release channel test server did not start");
      await new FetchReleaseChannelTransport().fetch(`http://127.0.0.1:${address.port}/channel.json`, { version: runningVersion, channel: "public" });
      expect(headers).toEqual({
        host: expect.any(String),
        connection: "keep-alive",
        "x-adhisthana-version": runningVersion,
        "x-adhisthana-channel": "public"
      });
    } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
  });

  test("checks signed releases without sending anything beyond version and channel", async () => {
    const calls: Array<{ url: string; metadata: unknown }> = [];
    let manifest: object | undefined = signed("public", releases("0.1.0"));
    const server = createTestApp(manager(), {
      releaseChannelTransport: {
        async fetch(url: string, metadata: unknown) {
          calls.push({ url, metadata });
          if (!manifest) throw new Error("channel unreachable");
          return JSON.stringify(manifest);
        }
      },
      releaseChannelStore: new MemoryReleaseChannelStore(),
      releaseChannelPublicKey: publicKey
    });

    expect((await server.inject({ method: "POST", url: "/api/release-channel/check" })).json()).toEqual({
      status: "available", release: releases("0.1.0")[0]
    });
    expect(calls).toEqual([{ url: "https://releases.adhisthana.dev/channel.json", metadata: { version: runningVersion, channel: "public" } }]);

    manifest = signed("public", releases(runningVersion));
    expect((await server.inject({ method: "POST", url: "/api/release-channel/check" })).json()).toEqual({ status: "current" });

    manifest = { channel: "public", releases: releases("0.2.0") };
    expect((await server.inject({ method: "POST", url: "/api/release-channel/check" })).json()).toEqual(expect.objectContaining({ status: "failed", error: "release channel signature is missing" }));

    manifest = { ...signed("public", releases("0.2.0")), signature: "wrong" };
    expect((await server.inject({ method: "POST", url: "/api/release-channel/check" })).json()).toEqual(expect.objectContaining({ status: "failed", error: "release channel signature is invalid" }));

    manifest = signed("public", [{ version: "0.2.0", download: "", checksum: "", notes: "" }]);
    expect((await server.inject({ method: "POST", url: "/api/release-channel/check" })).json()).toEqual(expect.objectContaining({ status: "failed", error: "release channel signature is invalid" }));

    expect((await server.inject({ method: "PUT", url: "/api/release-channel", payload: { channel: "internal", url: "https://updates.internal/channel.json" } })).json()).toEqual({ channel: "internal", url: "https://updates.internal/channel.json" });
    manifest = signed("internal", releases("0.3.0"));
    expect((await server.inject({ method: "POST", url: "/api/release-channel/check" })).json()).toEqual({ status: "available", release: releases("0.3.0")[0] });
    expect(calls.at(-1)).toEqual({ url: "https://updates.internal/channel.json", metadata: { version: runningVersion, channel: "internal" } });

    manifest = undefined;
    expect((await server.inject({ method: "POST", url: "/api/release-channel/check" })).json()).toEqual(expect.objectContaining({ status: "failed", error: "channel unreachable" }));
  });

  test("migrates persisted channel configuration and refuses a newer schema", async () => {
    const directory = await mkdtemp(join(tmpdir(), "release-channel-"));
    const path = join(directory, "release-channel.json");
    try {
      await writeFile(path, JSON.stringify({ channel: "internal", url: "https://updates.internal/channel.json" }), "utf8");
      expect(new FileReleaseChannelStore(path).get()).toEqual({ channel: "internal", url: "https://updates.internal/channel.json" });
      expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ schemaVersion: 1, configuration: { channel: "internal", url: "https://updates.internal/channel.json" } });
      await writeFile(path, JSON.stringify({ schemaVersion: 2, configuration: { channel: "internal", url: "https://updates.internal/channel.json" } }), "utf8");
      expect(() => new FileReleaseChannelStore(path)).toThrow("Release channel schema version 2 is newer than supported version 1");
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
