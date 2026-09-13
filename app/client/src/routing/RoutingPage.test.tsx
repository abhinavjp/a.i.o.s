import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { RoutingPage } from "./RoutingPage.js";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const document = {
  version: 1 as const,
  global: { version: 1, primary: { engine: "hermes" as const, configuration: "default", billingMode: "subscription" as const }, fallbacks: [], fallbackEnabled: false },
  workflows: {}, agents: {}, consent: { crossEngineFallback: false, paidFallback: false, acceptedAt: null }
};

describe("RoutingPage", () => {
  test("shows all engines, effective source, and Hermes repair state", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => document }));
    render(<RoutingPage />);
    expect(await screen.findByRole("heading", { name: "Choose the engine that moves work." })).toBeTruthy();
    expect(screen.getAllByText("Codex").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Claude Code").length).toBeGreaterThan(0);
    expect(screen.getByText(/Repair the Hermes UV\/Python launcher/)).toBeTruthy();
    expect(screen.getByText(/effective source · global/)).toBeTruthy();
  });

  test("saves a named Codex global configuration without rendering secrets", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string, options?: RequestInit) => {
      if (url === "/api/routing/global") return Promise.resolve({ ok: true, json: async () => ({ routing: { ...document, global: { ...document.global, primary: { engine: "codex", configuration: "work", billingMode: "subscription" }, version: 2 } } }) });
      return Promise.resolve({ ok: true, json: async () => document });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<RoutingPage />);
    await screen.findByRole("heading", { name: "Choose the engine that moves work." });
    fireEvent.change(screen.getByLabelText("Global engine"), { target: { value: "codex" } });
    fireEvent.change(screen.getByLabelText("Named configuration"), { target: { value: "work" } });
    fireEvent.click(screen.getByRole("button", { name: "Save global policy" }));
    await screen.findByRole("status");
    expect(fetchMock).toHaveBeenCalledWith("/api/routing/global", expect.objectContaining({ method: "PUT", body: expect.stringContaining('"engine":"codex"') }));
    expect(JSON.stringify(fetchMock.mock.calls)).not.toMatch(/apiKey|token|password/i);
  });
});
