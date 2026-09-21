import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { App } from "./App.js";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("first run", () => {
  test("shows work source, code host, then agent with their connection actions", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => ({ ok: true, json: async () => url === "/api/setup" ? { firstRun: true, steps: { workSource: false, codeHost: false, agent: false } } : url === "/api/agents" ? { agents: [] } : url === "/api/sarathi/dashboard" ? { runtime: {}, discovery: {}, tickets: [] } : {} })));
    render(<App />);
    expect(await screen.findByText("1. Work source")).toBeTruthy();
    expect(screen.getByText("2. Code host")).toBeTruthy();
    expect(screen.getByText("3. Agent")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Connect work source" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Connect code host" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Connect agent" })).toBeTruthy();
  });

  test("keeps the normal console for an existing installation", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => ({ ok: true, json: async () => url === "/api/setup" ? { firstRun: false, steps: { workSource: true, codeHost: true, agent: true } } : url === "/api/agents" ? { agents: [] } : url === "/api/sarathi/dashboard" ? { runtime: { name: "Fake", state: "unavailable", billingMode: "fake", reason: "offline" }, discovery: { status: "blocked", reason: "offline", lastCheckedAt: null, mergeRequests: [] }, tickets: [] } : {} })));
    render(<App />);
    expect(await screen.findByRole("textbox", { name: /task/i })).toBeTruthy();
    expect(screen.queryByText("Connect Adhiṣṭhāna")).toBeNull();
  });
});
