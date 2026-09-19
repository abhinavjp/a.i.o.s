import { describe, expect, test, vi } from "vitest";
import { ConnectorConfigurator, NullCodeHost, NullWorkSource } from "../src/index.js";

describe("ConnectorConfigurator", () => {
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
