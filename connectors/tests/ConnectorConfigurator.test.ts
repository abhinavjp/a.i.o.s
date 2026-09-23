import { describe, expect, test, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { adhisthanaBranch, ConnectorConfigurator, CredentialConfigurator, CredentialManager, FileCredentialReferenceStore, FakeCodeHost, GitLabCodeHost, JiraWorkSource, KeychainCredentialStrategy, NullCodeHost, NullWorkSource, SecretCommandCredentialStrategy, type GitLabTransport } from "../src/index.js";

describe("ConnectorConfigurator", () => {
  test("saves only a keychain reference to disk and resolves its value lazily", async () => {
    const directory = await mkdtemp(join(tmpdir(), "aios-credential-"));
    const value = "keychain-only-test-value";
    const keychain = { save: vi.fn(async () => undefined), read: vi.fn(async () => ({ value })) };
    const configurator = new CredentialConfigurator();
    configurator.register("keychain", new KeychainCredentialStrategy(keychain));
    const manager = new CredentialManager(new FileCredentialReferenceStore(join(directory, "credentials.json")), configurator);
    try {
      expect(keychain.read).not.toHaveBeenCalled();
      await manager.saveToKeychain("jira", value, "jira-entry");
      expect(keychain.save).toHaveBeenCalledWith("jira-entry", value);
      const onDisk = await readFile(join(directory, "credentials.json"), "utf8");
      expect(onDisk).toContain("jira-entry");
      expect(onDisk).not.toContain(value);
      await expect(manager.resolve("jira")).resolves.toEqual({ value });
      expect(keychain.read).toHaveBeenCalledWith("jira-entry");
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  test("migrates reference-only state, supports secret commands, and clearly stops on a missing entry", async () => {
    const directory = await mkdtemp(join(tmpdir(), "aios-credential-migration-"));
    const path = join(directory, "credentials.json");
    await writeFile(path, JSON.stringify({ credentials: { command: { reference: "command", source: "command", commandReference: "ADHISTHANA_JIRA_COMMAND" } } }), "utf8");
    const runner = { run: vi.fn(async () => "command-test-value\n") };
    const keychain = { save: vi.fn(async () => undefined), read: vi.fn(async () => null) };
    const configurator = new CredentialConfigurator();
    configurator.register("keychain", new KeychainCredentialStrategy(keychain));
    configurator.register("command", new SecretCommandCredentialStrategy(runner));
    const store = new FileCredentialReferenceStore(path);
    const manager = new CredentialManager(store, configurator);
    try {
      expect(store.snapshot().schemaVersion).toBe(1);
      await expect(manager.resolve("command")).resolves.toEqual({ value: "command-test-value" });
      expect(runner.run).toHaveBeenCalledWith("ADHISTHANA_JIRA_COMMAND");
      manager.saveSecretCommand("alternate", "ADHISTHANA_GITLAB_COMMAND");
      await expect(manager.resolve("missing")).rejects.toThrow("Credential reference is not configured: missing");
      await manager.saveToKeychain("missing-entry", "keychain-only-test-value", "absent-entry");
      await expect(manager.resolve("missing-entry")).rejects.toThrow("Credential keychain entry is missing: absent-entry");
      const onDisk = await readFile(path, "utf8");
      expect(onDisk).not.toContain("command-test-value");
      expect(onDisk).not.toContain("keychain-only-test-value");
      expect(onDisk).not.toContain("password-manager --token");
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  test("stops a connector action before its transport when the keychain entry is missing", async () => {
    const directory = await mkdtemp(join(tmpdir(), "aios-credential-missing-action-"));
    const store = new FileCredentialReferenceStore(join(directory, "credentials.json"));
    const configurator = new CredentialConfigurator();
    configurator.register("keychain", new KeychainCredentialStrategy({ save: async () => undefined, read: async () => null }));
    const manager = new CredentialManager(store, configurator);
    const search = vi.fn(async () => []);
    await manager.saveToKeychain("jira", "keychain-only-test-value", "missing-jira-entry");
    const source = new JiraWorkSource({ siteUrl: "https://jira.example.test", searchQuery: "assignee = currentUser()", credentialReference: "jira", credentialResolver: manager, transport: { search, read: async () => null } });
    try {
      await expect(source.listAssignedTickets()).rejects.toThrow("Credential keychain entry is missing: missing-jira-entry");
      expect(search).not.toHaveBeenCalled();
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
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
    const host = new GitLabCodeHost({ siteUrl: "http://gitlab.internal", projectId: "group/project", defaultBranch: "trunk", credentialReference: "GITLAB_TOKEN", credentialResolver: { resolve: async () => ({ value: "never-persisted", expiresAt: "2026-09-10T00:00:00.000Z" }) }, transport: { listMergeRequests, readPipeline: async () => null, listDiscussions: async () => [], readFile: async () => null, readDiff: async () => null } }, () => Date.parse("2026-09-07T00:00:00Z"));
    await expect(host.listMergeRequests("work-1")).resolves.toEqual([{ repository: "group/project", number: 42, title: "Fix export", branch: "work-1", state: "opened", pipelineId: null, pipelineResult: "running", jobsCompleted: 0, jobsTotal: 0 }]);
    await expect(host.connectionStatus()).resolves.toEqual({ siteUrl: "http://gitlab.internal", credentialReference: "GITLAB_TOKEN", daysUntilExpiry: 3, expiresSoon: true });
    expect(listMergeRequests).toHaveBeenCalledWith({ siteUrl: "http://gitlab.internal", projectId: "group/project", branch: "work-1", token: "never-persisted" });
  });
  test("normalizes GitLab pipelines and discussions with stable IDs and human/system resolution state", async () => {
    const credentialValue = "private-gitlab-token";
    const transport: GitLabTransport = {
      listMergeRequests: async () => [{ iid: 42, title: "Fix export", source_branch: "work-1", state: "opened", head_pipeline: { id: 7, status: "running" } }],
      readPipeline: async () => ({ id: 7, status: "success", ref: "work-1", sha: "abc123", web_url: "http://gitlab.internal/group/project/-/pipelines/7", updated_at: "2026-09-22T12:00:00Z" }),
      listDiscussions: async () => [
        { id: "thread-human", individual_note: false, notes: [{ id: 101, type: "DiscussionNote", body: "Please handle empty exports.", author: { id: 8, username: "reviewer", name: "Review User", state: "active", avatar_url: null, web_url: "http://gitlab.internal/reviewer" }, created_at: "2026-09-22T10:00:00Z", updated_at: "2026-09-22T10:00:00Z", system: false, noteable_id: 42, noteable_type: "MergeRequest", project_id: 9, resolved: false, resolvable: true, resolved_by: null, resolved_at: null, position: null, suggestions: [] }] },
        { id: "thread-system", individual_note: true, notes: [{ id: 102, type: null, body: "merged", author: { id: 1, username: "maintainer", name: "Maintainer", state: "active", avatar_url: null, web_url: "http://gitlab.internal/maintainer" }, created_at: "2026-09-22T11:00:00Z", updated_at: "2026-09-22T11:00:00Z", system: true, noteable_id: 42, noteable_type: "MergeRequest", project_id: 9, resolved: false, resolvable: false, resolved_by: null, resolved_at: null, position: null, suggestions: [] }] },
        { id: "thread-resolved", individual_note: false, notes: [{ id: 103, type: "DiscussionNote", body: "This is fixed.", author: { id: 8, username: "reviewer", name: "Review User", state: "active", avatar_url: null, web_url: "http://gitlab.internal/reviewer" }, created_at: "2026-09-22T09:00:00Z", updated_at: "2026-09-22T12:00:00Z", system: false, noteable_id: 42, noteable_type: "MergeRequest", project_id: 9, resolved: true, resolvable: true, resolved_by: { id: 3, username: "owner", name: "Project Owner" }, resolved_at: "2026-09-22T12:00:00Z", position: null, suggestions: [] }] }
      ],
      readFile: async () => null,
      readDiff: async () => null
    };
    const host = new GitLabCodeHost({ siteUrl: "http://gitlab.internal", projectId: "group/project", defaultBranch: "trunk", credentialReference: "GITLAB_TOKEN", credentialResolver: { resolve: async () => ({ value: credentialValue }) }, transport });

    await expect(host.listMergeRequests("work-1")).resolves.toEqual([{ repository: "group/project", number: 42, title: "Fix export", branch: "work-1", state: "opened", pipelineResult: "running", jobsCompleted: 0, jobsTotal: 0, pipelineId: "7" }]);
    await expect(host.readPipeline("7")).resolves.toEqual({ id: "7", repository: "group/project", status: "success", ref: "work-1", sha: "abc123", webUrl: "http://gitlab.internal/group/project/-/pipelines/7", updatedAt: "2026-09-22T12:00:00Z" });
    await expect(host.listDiscussions(42)).resolves.toEqual([
      { projectId: "group/project", mergeRequestIid: 42, discussionId: "thread-human", resolved: false, notes: [{ id: 101, body: "Please handle empty exports.", author: { id: 8, username: "reviewer", name: "Review User" }, authorship: "human", system: false, resolvable: true, resolved: false, createdAt: "2026-09-22T10:00:00Z", updatedAt: "2026-09-22T10:00:00Z" }] },
      { projectId: "group/project", mergeRequestIid: 42, discussionId: "thread-system", resolved: false, notes: [{ id: 102, body: "merged", author: { id: 1, username: "maintainer", name: "Maintainer" }, authorship: "system", system: true, resolvable: false, resolved: false, createdAt: "2026-09-22T11:00:00Z", updatedAt: "2026-09-22T11:00:00Z" }] },
      { projectId: "group/project", mergeRequestIid: 42, discussionId: "thread-resolved", resolved: true, notes: [{ id: 103, body: "This is fixed.", author: { id: 8, username: "reviewer", name: "Review User" }, authorship: "human", system: false, resolvable: true, resolved: true, createdAt: "2026-09-22T09:00:00Z", updatedAt: "2026-09-22T12:00:00Z" }] }
    ]);
    expect(JSON.stringify(await host.listDiscussions(42))).not.toContain(credentialValue);
  });
  test("reads every GitLab merge-request and discussion page without putting credentials in URLs", async () => {
    const fetchSpy = vi.fn<typeof fetch>();
    const discussion = (id: string, noteId: number) => [{ id, individual_note: false, notes: [{ id: noteId, type: "DiscussionNote", body: "Review comment", author: { id: 8, username: "reviewer", name: "Review User", state: "active", avatar_url: null, web_url: "http://gitlab.internal/reviewer" }, created_at: "2026-09-22T10:00:00Z", updated_at: "2026-09-22T10:00:00Z", system: false, noteable_id: 42, noteable_type: "MergeRequest", project_id: 9, resolved: false, resolvable: true, resolved_by: null, resolved_at: null, position: null, suggestions: [] }] }];
    fetchSpy
      .mockResolvedValueOnce(new Response(JSON.stringify([{ iid: 41, title: "First", source_branch: "work", state: "opened" }]), { status: 200, headers: { "x-next-page": "2" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify([{ iid: 42, title: "Second", source_branch: "work", state: "opened" }]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(discussion("thread-1", 101)), { status: 200, headers: { link: '<http://gitlab.internal/api/v4/projects/group%2Fproject/merge_requests/42/discussions?page=2&per_page=100>; rel="next"' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify(discussion("thread-2", 102)), { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);
    const host = new GitLabCodeHost({ siteUrl: "http://gitlab.internal", projectId: "group/project", defaultBranch: "trunk", credentialReference: "GITLAB_TOKEN", credentialResolver: { resolve: async () => ({ value: "private-gitlab-token" }) } });

    try {
      await expect(host.listMergeRequests("work")).resolves.toEqual([
        { repository: "group/project", number: 41, title: "First", branch: "work", state: "opened", pipelineId: null, pipelineResult: "running", jobsCompleted: 0, jobsTotal: 0 },
        { repository: "group/project", number: 42, title: "Second", branch: "work", state: "opened", pipelineId: null, pipelineResult: "running", jobsCompleted: 0, jobsTotal: 0 }
      ]);
      await expect(host.listDiscussions(42)).resolves.toEqual(expect.arrayContaining([expect.objectContaining({ discussionId: "thread-1" }), expect.objectContaining({ discussionId: "thread-2" })]));
      expect(fetchSpy).toHaveBeenCalledTimes(4);
      expect(fetchSpy.mock.calls.map(([url]) => new URL(String(url)).searchParams.get("page"))).toEqual(["1", "2", "1", "2"]);
      for (const [url, init] of fetchSpy.mock.calls) {
        expect(String(url)).toMatch(/^http:\/\/gitlab\.internal\//);
        expect(String(url)).not.toContain("private-gitlab-token");
        expect(new Headers(init?.headers).get("PRIVATE-TOKEN")).toBe("private-gitlab-token");
      }
    } finally {
      vi.unstubAllGlobals();
    }
  });
  test("rejects malformed merge-request entries instead of projecting incomplete identities", async () => {
    const host = new GitLabCodeHost({
      siteUrl: "http://gitlab.internal", projectId: "group/project", defaultBranch: "trunk", credentialReference: "GITLAB_TOKEN",
      credentialResolver: { resolve: async () => ({ value: "private-gitlab-token" }) },
      transport: { listMergeRequests: async () => [{ title: "Missing IID", source_branch: "work", state: "opened" } as never], readPipeline: async () => null, listDiscussions: async () => [], readFile: async () => null, readDiff: async () => null }
    });

    await expect(host.listMergeRequests("work")).rejects.toThrow("GitLab merge request response was incomplete");
  });
  test("reports GitLab 404 and malformed discussion pages as explicit read failures", async () => {
    const fetchSpy = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("not found", { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: "bad page" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);
    const host = new GitLabCodeHost({ siteUrl: "http://gitlab.internal", projectId: "group/project", defaultBranch: "trunk", credentialReference: "GITLAB_TOKEN", credentialResolver: { resolve: async () => ({ value: "private-gitlab-token" }) } });
    try {
      await expect(host.listMergeRequests("work")).rejects.toThrow("GitLab project read failed (404)");
      await expect(host.listDiscussions(42)).rejects.toThrow("GitLab discussion read returned an invalid page");
    } finally { vi.unstubAllGlobals(); }
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
