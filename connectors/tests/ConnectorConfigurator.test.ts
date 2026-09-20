import { describe, expect, test, vi } from "vitest";
import { adhisthanaBranch, ConnectorConfigurator, FakeCodeHost, GitLabCodeHost, JiraWorkSource, NullCodeHost, NullWorkSource } from "../src/index.js";

describe("ConnectorConfigurator", () => {
  test("structurally refuses dangerous writes while allowing Adhisthana branch work", async () => {
    const host = new FakeCodeHost();
    const branch = adhisthanaBranch("OPS-33", "implementation");
    expect(branch).toBe("adhisthana/OPS-33/implementation");
    await expect(host.push(branch)).resolves.toBeUndefined();
    await expect(host.push("adhisthana/OPS-33")).rejects.toThrow(/Adhisthana branch/);
    await expect(host.merge()).rejects.toThrow(/permanently refuses/);
    await expect(host.markMergeRequestReady()).rejects.toThrow(/permanently refuses/);
    await expect(host.deleteBranch("operator/fix")).rejects.toThrow(/Adhisthana branch/);
  });
  test("reads GitLab through an external credential reference over plain HTTP and reports expiry", async () => {
    const listMergeRequests = vi.fn().mockResolvedValue([{ iid: 42, title: "Fix export", source_branch: "work-1", state: "opened", head_pipeline: { status: "running", detailed_status: { details_path: "/pipelines/7" } } }]);
    const host = new GitLabCodeHost({ siteUrl: "http://gitlab.internal", projectId: "group/project", defaultBranch: "trunk", credentialReference: "GITLAB_TOKEN", credentialResolver: { resolve: async () => ({ value: "never-persisted", expiresAt: "2026-09-10T00:00:00.000Z" }) }, transport: { listMergeRequests, readPipeline: async () => null, readFile: async () => null, readDiff: async () => null } }, () => Date.parse("2026-09-07T00:00:00Z"));
    await expect(host.listMergeRequests("work-1")).resolves.toEqual([{ repository: "group/project", number: 42, title: "Fix export", branch: "work-1", state: "opened", pipelineResult: "running", jobsCompleted: 0, jobsTotal: 0 }]);
    await expect(host.connectionStatus()).resolves.toEqual({ siteUrl: "http://gitlab.internal", credentialReference: "GITLAB_TOKEN", daysUntilExpiry: 3, expiresSoon: true });
    expect(listMergeRequests).toHaveBeenCalledWith({ siteUrl: "http://gitlab.internal", projectId: "group/project", branch: "work-1", token: "never-persisted" });
  });
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
