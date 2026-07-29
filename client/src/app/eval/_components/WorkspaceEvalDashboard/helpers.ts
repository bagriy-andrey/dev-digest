/** Pure helpers for the workspace eval dashboard — no I/O, no React. */
import type { EvalAgentRow } from "@/lib/types";

/** Client-side stable sort by agent name — a TanStack Query refetch (e.g.
 *  after "Run all agents" invalidates the dashboard) can return agents in a
 *  different server-side order, which visibly reshuffles the list. Always
 *  sort client-side before rendering (`client/insights.md` — "List thrashing
 *  after TanStack Query refetch"). */
export function sortAgentsByName(agents: EvalAgentRow[]): EvalAgentRow[] {
  return [...agents].sort((a, b) => a.agent_name.localeCompare(b.agent_name));
}

/** Total case count across every agent row — surfaced before "Run all
 *  agents" is confirmed (edge case 16: an N-agent run-all is N batches of
 *  real, paid model calls). */
export function totalCaseCount(agents: EvalAgentRow[]): number {
  return agents.reduce((sum, a) => sum + a.cases_total, 0);
}

/** Shape shared by `EvalBatchSummary` and `EvalAgentRow.last_batch` — kept
 *  narrow so this helper stays pure and doesn't need the full contract type. */
export interface BatchLike {
  agent_version: number | null;
  ran_at: string;
  cases_passed: number;
  cases_total: number;
}

/** `date` is pre-formatted by the caller (`toLocaleDateString()`) so this
 *  helper never touches `Intl`/timezone concerns itself — kept pure and
 *  independently testable. */
export function batchLineParts(batch: BatchLike): {
  version: string;
  date: string;
  passed: number;
  total: number;
} {
  return {
    version: batch.agent_version != null ? String(batch.agent_version) : "—",
    date: new Date(batch.ran_at).toLocaleDateString(),
    passed: batch.cases_passed,
    total: batch.cases_total,
  };
}
