import type { Agent } from "@devdigest/shared";

/** Stable order across refetches (client insights: always sort lists that can
 *  reorder on a background refetch rather than relying on API order). */
export function sortAgentsByName(agents: Agent[]): Agent[] {
  return [...agents].sort((a, b) => a.name.localeCompare(b.name));
}

/** Pure toggle: add/remove one id from a selection set without mutating the
 *  input (derive, don't mutate — react-best-practices). */
export function toggleId(selected: Set<string>, id: string): Set<string> {
  const next = new Set(selected);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}
