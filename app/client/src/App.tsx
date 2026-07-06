import { useEffect, useRef, useState } from "react";
import type { AgentInfo, HealthStatus } from "@aios/contracts";

type AgentListItem = AgentInfo & { health: HealthStatus };

type RunStatus = "idle" | "running" | "done";

export function App() {
  const [agents, setAgents] = useState<AgentListItem[]>([]);
  const [task, setTask] = useState("");
  const [status, setStatus] = useState<RunStatus>("idle");
  const [output, setOutput] = useState<string[]>([]);
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    fetch("/api/agents")
      .then((res) => res.json())
      .then((data) => setAgents(data.agents));
  }, []);

  useEffect(() => {
    return () => {
      eventSourceRef.current?.close();
    };
  }, []);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    eventSourceRef.current?.close();

    setOutput([]);
    setStatus("running");

    const response = await fetch("/api/agents/active/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task })
    });
    const { taskId } = await response.json();

    const eventSource = new EventSource(`/api/agents/active/tasks/${taskId}/stream`);
    eventSourceRef.current = eventSource;

    eventSource.onmessage = (event) => {
      setOutput((prev) => [...prev, event.data]);
    };

    eventSource.addEventListener("done", () => {
      eventSource.close();
      setStatus("done");
    });
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

      {status === "done" && <p>Run finished (done)</p>}
    </main>
  );
}
