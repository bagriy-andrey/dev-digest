import type { Agent } from "@devdigest/shared";

/** Case-insensitive filter + stable alphabetical sort over agents. */
export function filterAgents(agents: Agent[], search: string): Agent[] {
  const q = search.trim().toLowerCase();
  const filtered = q
    ? agents.filter((a) => `${a.name} ${a.description}`.toLowerCase().includes(q))
    : agents;
  return [...filtered].sort((a, b) => a.name.localeCompare(b.name));
}
