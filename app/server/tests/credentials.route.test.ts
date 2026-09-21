import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test, vi } from "vitest";
import { AgentConfigurator, AgentManager } from "@aios/agents";
import { CredentialConfigurator, CredentialManager, FileCredentialReferenceStore, KeychainCredentialStrategy, SecretCommandCredentialStrategy } from "@aios/connectors";
import { createTestApp } from "./testApp.js";

describe("credential routes", () => {
  test("stores keychain and command references without ever writing their secret values", async () => {
    const directory = await mkdtemp(join(tmpdir(), "aios-credential-route-"));
    const path = join(directory, "credentials.json");
    const value = "http-boundary-test-value";
    const keychain = { save: vi.fn(async () => undefined), read: vi.fn(async () => ({ value })) };
    const runner = { run: vi.fn(async () => "command-value\n") };
    const configurator = new CredentialConfigurator();
    configurator.register("keychain", new KeychainCredentialStrategy(keychain));
    configurator.register("command", new SecretCommandCredentialStrategy(runner));
    const manager = new CredentialManager(new FileCredentialReferenceStore(path), configurator);
    const app = createTestApp(new AgentManager(new AgentConfigurator(), "missing"), { credentialManager: manager });
    try {
      const saved = await app.inject({ method: "POST", url: "/api/credentials/keychain", payload: { reference: "jira", keychainEntry: "jira-entry", value } });
      expect(saved.statusCode).toBe(200);
      expect(saved.json()).toEqual({ credential: { reference: "jira", source: "keychain", keychainEntry: "jira-entry" } });
      expect(keychain.save).toHaveBeenCalledWith("jira-entry", value);
      const command = await app.inject({ method: "POST", url: "/api/credentials/command", payload: { reference: "gitlab", commandReference: "ADHISTHANA_GITLAB_COMMAND" } });
      expect(command.statusCode).toBe(200);
      const rejected = await app.inject({ method: "POST", url: "/api/credentials/command", payload: { reference: "unsafe", commandReference: "password-manager --token http-boundary-test-value" } });
      expect(rejected.statusCode).toBe(400);
      const onDisk = await readFile(path, "utf8");
      expect(onDisk).not.toContain(value);
      expect(onDisk).not.toContain("command-value");
      expect(onDisk).not.toContain("password-manager --token");
      await expect(manager.resolve("jira")).resolves.toEqual({ value });
      await expect(manager.resolve("gitlab")).resolves.toEqual({ value: "command-value" });
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
