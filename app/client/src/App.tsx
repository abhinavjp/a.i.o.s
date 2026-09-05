import { useEffect, useRef, useState } from "react";
import type {
  AgentInfo,
  HealthStatus,
  TaskOutcome,
  TaskTerminalStatus
} from "@aios/contracts";

type AgentListItem = AgentInfo & { health: HealthStatus };

type RunStatus = "idle" | "running" | TaskTerminalStatus;

const LAST_TASK_STORAGE_KEY = "lastTaskId";

function parseTaskOutcome(data: string): TaskOutcome {
  if (data.length === 0) {
    return { status: "completed" };
  }

  try {
    const parsed: unknown = JSON.parse(data);
    if (typeof parsed === "object" && parsed !== null) {
      const status = (parsed as { status?: unknown }).status;
      if (
        status === "completed" ||
        status === "failed" ||
        status === "blocked" ||
        status === "unavailable"
      ) {
        const message = (parsed as { message?: unknown }).message;
        return typeof message === "string" ? { status, message } : { status };
      }
    }
  } catch {
    // Treat malformed terminal data as a failed task instead of showing it as done.
  }

  return { status: "failed", message: "task returned an invalid outcome" };
}

export function App() {
  const [agents, setAgents] = useState<AgentListItem[]>([]);
  const [task, setTask] = useState("");
  const [status, setStatus] = useState<RunStatus>("idle");
  const [output, setOutput] = useState<string[]>([]);
  const eventSourceRef = useRef<EventSource | null>(null);

  function openTaskStream(taskId: string) {
    eventSourceRef.current?.close();
    setOutput([]);
    setStatus("running");
    localStorage.setItem(LAST_TASK_STORAGE_KEY, taskId);

    const eventSource = new EventSource(`/api/agents/active/tasks/${taskId}/stream`);
    eventSourceRef.current = eventSource;

    eventSource.onmessage = (event) => {
      setOutput((prev) => [...prev, event.data]);
    };

    eventSource.addEventListener("done", (event) => {
      const outcome = parseTaskOutcome((event as MessageEvent<string>).data);
      eventSource.close();
      setStatus(outcome.status);
    });
  }

  useEffect(() => {
    fetch("/api/agents")
      .then((res) => res.json())
      .then((data) => setAgents(data.agents));

    const lastTaskId = localStorage.getItem(LAST_TASK_STORAGE_KEY);
    if (lastTaskId) {
      openTaskStream(lastTaskId);
    }
  }, []);

  useEffect(() => {
    return () => {
      eventSourceRef.current?.close();
    };
  }, []);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const response = await fetch("/api/agents/active/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task })
    });
    const { taskId } = await response.json();
    openTaskStream(taskId);
  }

  return (
    <main>
      <h1>Adhiṣṭhāna</h1>
      <ul>
        {agents.map((agent) => (
          <li key={agent.id}>
            <span>{agent.displayName}</span>
            <span>{agent.health.ok ? "healthy" : agent.health.reason}</span>
          </li>
        ))}
      </ul>

      <form onSubmit={handleSubmit}>
        <label htmlFor="task-input">Task</label>
        <input
          id="task-input"
          type="text"
          value={task}
          onChange={(event) => setTask(event.target.value)}
        />
        <button type="submit">Run</button>
      </form>

      <pre>{output.join("\n")}</pre>

      {status !== "idle" && <p>Run status: {status}</p>}
    </main>
  );
}
