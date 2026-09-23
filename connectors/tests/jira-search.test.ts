import { afterEach, describe, expect, test, vi } from "vitest";
import { FetchJiraTransport, type JiraIssue } from "../src/index.js";

const input = { siteUrl: "https://jira.example.test", searchQuery: "project = OPS", token: "test-token" };

afterEach(() => { vi.unstubAllGlobals(); });

function issue(key: string): JiraIssue {
  return { key, fields: { summary: `Work ${key}`, issuetype: { name: "Task" }, status: { name: "Open" }, description: "" } };
}

describe("FetchJiraTransport search", () => {
  test("fails closed when a successful response has no issues array", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ isLast: true }), { status: 200 })));

    await expect(new FetchJiraTransport().search(input)).rejects.toThrow("Jira search returned an invalid page");
  });

  test("fails closed when issues is not an array", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ issues: {}, isLast: true }), { status: 200 })));

    await expect(new FetchJiraTransport().search(input)).rejects.toThrow("Jira search returned an invalid page");
  });

  test("follows enhanced-search page tokens and returns only the complete result", async () => {
    const urls: URL[] = [];
    const fetch = vi.fn(async (request: string) => {
      const url = new URL(request);
      urls.push(url);
      const page = url.searchParams.get("nextPageToken")
        ? { issues: [issue("OPS-2")], isLast: true }
        : { issues: [issue("OPS-1")], isLast: false, nextPageToken: "cursor-2" };
      return new Response(JSON.stringify(page), { status: 200 });
    });
    vi.stubGlobal("fetch", fetch);

    await expect(new FetchJiraTransport().search(input)).resolves.toEqual([issue("OPS-1"), issue("OPS-2")]);

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(urls.map((url) => url.pathname)).toEqual(["/rest/api/3/search/jql", "/rest/api/3/search/jql"]);
    expect(urls[0].searchParams.get("jql")).toBe("project = OPS");
    expect(urls[0].searchParams.get("fields")).toBe("summary,issuetype,status,description");
    expect(urls[1].searchParams.get("nextPageToken")).toBe("cursor-2");
  });

  test("fails closed when a non-final page has no usable continuation token", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ issues: [issue("OPS-1")], isLast: false }), { status: 200 })));

    await expect(new FetchJiraTransport().search(input)).rejects.toThrow("Jira search returned an incomplete page");
  });

  test("fails closed when pagination does not finish within the bounded page budget", async () => {
    const fetch = vi.fn(async (request: string) => {
      const pageNumber = new URL(request).searchParams.get("nextPageToken")?.replace("cursor-", "") ?? "0";
      return new Response(JSON.stringify({ issues: [issue(`OPS-${pageNumber}`)], isLast: false, nextPageToken: `cursor-${Number(pageNumber) + 1}` }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetch);

    await expect(new FetchJiraTransport().search(input)).rejects.toThrow("Jira search exceeded its page limit");

    expect(fetch).toHaveBeenCalledTimes(100);
  });
});
