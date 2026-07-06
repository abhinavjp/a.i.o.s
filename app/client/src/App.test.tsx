import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { App } from "./App.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("App", () => {
  test("renders the agent list with name and health from the BFF", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          agents: [
            { id: "fake", kind: "fake", displayName: "Fake Agent", health: { ok: true } }
          ]
        })
      })
    );

    render(<App />);

    expect(await screen.findByText("Fake Agent")).toBeTruthy();
    expect(screen.getByText("healthy")).toBeTruthy();
  });
});
