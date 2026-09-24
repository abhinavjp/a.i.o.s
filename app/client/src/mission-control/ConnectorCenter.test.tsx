import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ConnectorCenter } from "./ConnectorCenter.js";
import { readConnectorOverview, saveCredentialToKeychain } from "./api.js";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const emptyOverview = {
  workSource: { status: "unconfigured" as const },
  codeHost: { status: "error" as const, message: "The connection read failed." },
  jiraSync: { status: "available" as const, data: { configured: false, state: "unconfigured" as const, lastAttemptAt: null, lastSuccessAt: null, lastFailureAt: null, failed: false } },
  gitLabSync: { status: "available" as const, data: { configured: false, state: "unconfigured" as const, stale: false, lastAttemptAt: null, lastSuccessAt: null, lastFailureAt: null, failed: false } }
};
const loadingOverview = { workSource: { status: "loading" as const }, codeHost: { status: "loading" as const }, jiraSync: { status: "loading" as const }, gitLabSync: { status: "loading" as const } };
const readyOverview = {
  workSource: { status: "available" as const, data: { siteUrl: "https://jira.example.test", credentialReference: "JIRA_TOKEN", daysUntilExpiry: null, expiresSoon: false } },
  codeHost: { status: "available" as const, data: { siteUrl: "https://gitlab.example.test", credentialReference: "GITLAB_TOKEN", daysUntilExpiry: null, expiresSoon: false } },
  jiraSync: { status: "available" as const, data: { configured: true, state: "available" as const, lastAttemptAt: "2026-09-23T10:00:00Z", lastSuccessAt: "2026-09-23T10:00:00Z", lastFailureAt: null, failed: false } },
  gitLabSync: { status: "available" as const, data: { configured: true, state: "available" as const, stale: false, lastAttemptAt: "2026-09-23T10:00:00Z", lastSuccessAt: "2026-09-23T10:00:00Z", lastFailureAt: null, failed: false } }
};

function setupProps(overrides: Partial<React.ComponentProps<typeof ConnectorCenter>> = {}) {
  return {
    overview: emptyOverview,
    agents: [],
    agentsStatus: "available" as const,
    isSetup: true,
    onRefreshJira: vi.fn(async () => ({ ok: true as const, imported: 0, updated: 0, skipped: 0, missing: 0 })),
    onRefreshGitLab: vi.fn(async () => ({ ok: true as const })),
    onSaveCredential: vi.fn(async () => ({ ok: true as const })),
    onOpenAgentSettings: vi.fn(),
    ...overrides
  };
}

describe("Mission Control connector setup", () => {
  test("explains each sign-in field and what saving it does", () => {
    render(<ConnectorCenter {...setupProps()} />);

    expect(screen.getByRole("heading", { name: "1. Jira work items" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "2. GitLab code reviews" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "3. Agents" })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Name for the Jira token" })).toBeTruthy();
    expect(screen.getByLabelText("Jira API token")).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Name for the GitLab token" })).toBeTruthy();
    expect(screen.getByLabelText("GitLab access token")).toBeTruthy();
    expect(screen.getAllByText(/This is a label for the saved token, not the token itself/)).toHaveLength(2);
    expect(screen.getByText("Jira isn't connected yet.")).toBeTruthy();
    expect(screen.getByText(/Saving a token does not connect Jira or GitLab by itself/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open agent settings" })).toBeTruthy();
  });

  test("shows all three setup concerns with observed, distinct unavailable states", () => {
    render(<ConnectorCenter {...setupProps()} />);

    expect(screen.getByRole("heading", { name: "Connect Sarathi" })).toBeTruthy();
    expect(screen.getByText("1. Jira work items")).toBeTruthy();
    expect(screen.getByText("2. GitLab code reviews")).toBeTruthy();
    expect(screen.getByText("3. Agents")).toBeTruthy();
    expect(screen.getByText("Jira isn't connected yet.")).toBeTruthy();
    expect(screen.getByText("The connection read failed.")).toBeTruthy();
    expect(screen.getByText("No agent is ready to run tasks yet.")).toBeTruthy();
    expect(screen.queryByText("Connected")).toBeNull();
  });

  test("fills observed credential references when setup reads finish after the setup view mounted", () => {
    const view = render(<ConnectorCenter {...setupProps({ overview: loadingOverview })} />);
    view.rerender(<ConnectorCenter {...setupProps({ overview: readyOverview })} />);

    expect((screen.getByRole("textbox", { name: "Name for the Jira token" }) as HTMLInputElement).value).toBe("JIRA_TOKEN");
    expect((screen.getByRole("textbox", { name: "Name for the GitLab token" }) as HTMLInputElement).value).toBe("GITLAB_TOKEN");
  });

  test("sends a credential once, then clears it without rendering the secret", async () => {
    const save = vi.fn(async () => ({ ok: true as const }));
    render(<ConnectorCenter {...setupProps({ onSaveCredential: save })} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Name for the Jira token" }), { target: { value: "JIRA_TOKEN" } });
    fireEvent.change(screen.getByLabelText("Jira API token"), { target: { value: "token-that-must-not-return" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Jira token" }));

    await waitFor(() => expect(save).toHaveBeenCalledWith("JIRA_TOKEN", "token-that-must-not-return"));
    await waitFor(() => expect((screen.getByLabelText("Jira API token") as HTMLInputElement).value).toBe(""));
    expect(document.body.textContent).not.toContain("token-that-must-not-return");
  });

  test("keeps the credential value out of status reads, rendered state, and browser storage", async () => {
    const secret = "one-time-keychain-value";
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      requests.push({ url, init });
      const json = url === "/api/credentials/keychain"
        ? { credential: { reference: "JIRA_TOKEN", source: "keychain", value: secret } }
        : url === "/api/work-items/connection" || url === "/api/code-host/connection"
          ? { connection: { siteUrl: "https://example.test", credentialReference: "JIRA_TOKEN", daysUntilExpiry: null, expiresSoon: false, token: secret, value: secret } }
          : url === "/api/work-items/sync"
            ? { sync: { configured: true, state: "available", lastAttemptAt: "2026-09-23T10:00:00Z", lastSuccessAt: "2026-09-23T10:00:00Z", lastFailureAt: null, lastError: secret } }
            : { sync: { configured: true, state: "available", stale: false, lastAttemptAt: "2026-09-23T10:00:00Z", lastSuccessAt: "2026-09-23T10:00:00Z", lastFailureAt: null, lastError: secret } };
      return { ok: true, json: async () => json };
    }));

    expect(await saveCredentialToKeychain("JIRA_TOKEN", secret)).toEqual({ ok: true });
    const overview = await readConnectorOverview();
    render(<ConnectorCenter {...setupProps({ overview })} />);

    const write = requests.find((request) => request.url === "/api/credentials/keychain");
    expect(write?.init?.method).toBe("POST");
    expect(JSON.parse(String(write?.init?.body))).toEqual({ reference: "JIRA_TOKEN", value: secret });
    expect(requests.filter((request) => request.init?.method !== "POST").every((request) => request.init?.body === undefined)).toBe(true);
    expect(JSON.stringify(overview)).not.toContain(secret);
    expect(document.body.textContent).not.toContain(secret);
    expect(localStorage.length).toBe(0);
  });

  test("keeps Jira refresh explicit and routes GitLab sync through read-only callbacks", () => {
    const onRefreshJira = vi.fn(async () => ({ ok: true as const, imported: 0, updated: 0, skipped: 0, missing: 0 }));
    const onRefreshGitLab = vi.fn(async () => ({ ok: true as const }));
    render(<ConnectorCenter {...setupProps({ onRefreshJira, onRefreshGitLab })} />);

    fireEvent.click(screen.getByRole("button", { name: "Check Jira for work items" }));
    fireEvent.click(screen.getByRole("button", { name: "Check GitLab discussions" }));
    expect(onRefreshJira).toHaveBeenCalledOnce();
    expect(onRefreshGitLab).toHaveBeenCalledOnce();
  });
});
