import { afterEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { App } from "./App.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

type Listener = (event: { data: string }) => void;

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  url: string;
  onmessage: Listener | null = null;
  close = vi.fn();
  private listeners: Record<string, Listener[]> = {};

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: Listener) {
    this.listeners[type] ??= [];
    this.listeners[type].push(listener);
  }

  emitMessage(data: string) {
    this.onmessage?.({ data });
  }

  emitDone() {
    for (const listener of this.listeners["done"] ?? []) {
      listener({ data: "" });
    }
  }
}

function stubAgentsFetch() {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ agents: [] })
  });
}

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

  test("submitting a task POSTs then opens an EventSource to the stream URL", async () => {
    FakeEventSource.instances = [];
    vi.stubGlobal("EventSource", FakeEventSource);

    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === "/api/agents") {
        return stubAgentsFetch()();
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ taskId: "task-123" })
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    await screen.findByRole("textbox", { name: /task/i });

    fireEvent.change(screen.getByRole("textbox", { name: /task/i }), {
      target: { value: "do the thing" }
    });
    fireEvent.click(screen.getByRole("button", { name: /run/i }));

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/agents/active/tasks",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ task: "do the thing" })
        })
      );
    });

    await vi.waitFor(() => {
      expect(FakeEventSource.instances).toHaveLength(1);
    });
    expect(FakeEventSource.instances[0]?.url).toBe(
      "/api/agents/active/tasks/task-123/stream"
    );
  });

  test("renders message chunks in order as they arrive", async () => {
    FakeEventSource.instances = [];
    vi.stubGlobal("EventSource", FakeEventSource);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url === "/api/agents") {
          return stubAgentsFetch()();
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({ taskId: "task-abc" })
        });
      })
    );

    render(<App />);
    await screen.findByRole("textbox", { name: /task/i });

    fireEvent.change(screen.getByRole("textbox", { name: /task/i }), {
      target: { value: "do the thing" }
    });
    fireEvent.click(screen.getByRole("button", { name: /run/i }));

    await vi.waitFor(() => {
      expect(FakeEventSource.instances).toHaveLength(1);
    });
    const source = FakeEventSource.instances[0]!;

    act(() => {
      source.emitMessage("chunk one");
    });
    act(() => {
      source.emitMessage("chunk two");
    });

    expect(await screen.findByText(/chunk one/)).toBeTruthy();
    const text = screen.getByText(/chunk one/).textContent ?? "";
    expect(text.indexOf("chunk one")).toBeLessThan(text.indexOf("chunk two"));
  });

  test("done event closes the EventSource and shows finished indication", async () => {
    FakeEventSource.instances = [];
    vi.stubGlobal("EventSource", FakeEventSource);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url === "/api/agents") {
          return stubAgentsFetch()();
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({ taskId: "task-xyz" })
        });
      })
    );

    render(<App />);
    await screen.findByRole("textbox", { name: /task/i });

    fireEvent.change(screen.getByRole("textbox", { name: /task/i }), {
      target: { value: "do the thing" }
    });
    fireEvent.click(screen.getByRole("button", { name: /run/i }));

    await vi.waitFor(() => {
      expect(FakeEventSource.instances).toHaveLength(1);
    });
    const source = FakeEventSource.instances[0]!;

    act(() => {
      source.emitDone();
    });

    expect(await screen.findByText(/done/i)).toBeTruthy();
    expect(source.close).toHaveBeenCalled();
  });

  test("submitting a second task before the first stream's done closes the first EventSource and starts fresh output", async () => {
    FakeEventSource.instances = [];
    vi.stubGlobal("EventSource", FakeEventSource);

    let taskCounter = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url === "/api/agents") {
          return stubAgentsFetch()();
        }
        taskCounter += 1;
        return Promise.resolve({
          ok: true,
          json: async () => ({ taskId: `task-${taskCounter}` })
        });
      })
    );

    render(<App />);
    await screen.findByRole("textbox", { name: /task/i });

    const input = screen.getByRole("textbox", { name: /task/i });
    const button = screen.getByRole("button", { name: /run/i });

    fireEvent.change(input, { target: { value: "first task" } });
    fireEvent.click(button);

    await vi.waitFor(() => {
      expect(FakeEventSource.instances).toHaveLength(1);
    });
    const firstSource = FakeEventSource.instances[0]!;

    act(() => {
      firstSource.emitMessage("first task chunk");
    });
    expect(await screen.findByText(/first task chunk/)).toBeTruthy();

    // Submit a second task before the first stream's "done" ever fires.
    fireEvent.change(input, { target: { value: "second task" } });
    fireEvent.click(button);

    await vi.waitFor(() => {
      expect(FakeEventSource.instances).toHaveLength(2);
    });
    const secondSource = FakeEventSource.instances[1]!;

    // The first (abandoned) EventSource must have been closed.
    expect(firstSource.close).toHaveBeenCalled();

    // Output should have been reset for the new task.
    expect(screen.queryByText(/first task chunk/)).toBeNull();

    act(() => {
      secondSource.emitMessage("second task chunk");
    });
    expect(await screen.findByText(/second task chunk/)).toBeTruthy();
    expect(screen.queryByText(/first task chunk/)).toBeNull();
  });
});
