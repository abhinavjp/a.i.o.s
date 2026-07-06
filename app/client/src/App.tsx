import { useEffect, useState } from "react";
import type { AgentInfo, HealthStatus } from "@aios/contracts";

type AgentListItem = AgentInfo & { health: HealthStatus };

export function App() {
  const [agents, setAgents] = useState<AgentListItem[]>([]);

  useEffect(() => {
    fetch("/api/agents")
      .then((res) => res.json())
      .then((data) => setAgents(data.agents));
  }, []);

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
    </main>
  );
}
