import { describe, expect, test, vi } from "vitest";
import { ConnectorConfigurator, JiraWorkSource, NullCodeHost, NullWorkSource } from "../src/index.js";

describe("ConnectorConfigurator", () => {
  test("reads Jira tickets through an external credential reference and reports token expiry", async () => {
    const search = vi.fn().mockResolvedValue([{ key: "OPS-301", fields: { summary: "Import Jira work", issuetype: { name: "Task" }, status: { name: "Open" }, description: "Read only" } }]);
    const source = new JiraWorkSource({ siteUrl: "https://jira.example.test", searchQuery: "assignee = currentUser()", credentialReference: "JIRA_TOKEN", credentialResolver: { resolve: async () => ({ value: "never-persisted", expiresAt: "2026-09-10T00:00:00.000Z" }) }, transport: { search, read: async () => null } }, () => Date.parse("2026-09-07T00:00:00Z"));
    await expect(source.listAssignedTickets()).resolves.toEqual([{ key: "OPS-301", title: "Import Jira work", type: "Task", status: "Open", description: "Read only" }]);
    await expect(source.connectionStatus()).resolves.toEqual({ siteUrl: "https://jira.example.test", credentialReference: "JIRA_TOKEN", daysUntilExpiry: 3, expiresSoon: true });
    expect(search).toHaveBeenCalledWith({ siteUrl: "https://jira.example.test", searchQuery: "assignee = currentUser()", token: "never-persisted" });
    expect("transitionTicket" in source).toBe(false);
    expect("createTicket" in source).toBe(false);
  });
  test("registers and resolves implementations", () => {
    const configurator = new ConnectorConfigurator();
    const source = { listAssignedTickets: async () => [], readTicket: async () => null };
    configurator.registerWorkSource("fake", source);
    expect(configurator.resolveWorkSource("fake")).toBe(source);
  });
  test("uses null fallbacks and logs missing selections", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const configurator = new ConnectorConfigurator();
    const source = configurator.resolveWorkSource("missing");
    const host = configurator.resolveCodeHost("missing");
    expect(source).toBeInstanceOf(NullWorkSource);
    expect(await source.listAssignedTickets()).toEqual([]);
    expect(host).toBeInstanceOf(NullCodeHost);
    expect(await host.readFile("main", "a.txt")).toEqual({ available: false, content: null });
    expect(warn).toHaveBeenCalledTimes(2);
  });
});
