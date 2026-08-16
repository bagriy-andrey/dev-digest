import type { AgentRunEstimate } from "./types";

/** Look up one agent's estimate by id (undefined ⇒ no row for that agent). */
export function estimateFor(
  estimates: AgentRunEstimate[],
  agentId: string
): AgentRunEstimate | undefined {
  return estimates.find((e) => e.agent_id === agentId);
}

/** True only when the estimate carries real sampled history — never a
 *  fabricated/default figure (AC-9). */
export function hasHistory(e?: AgentRunEstimate): boolean {
  return !!e && e.runs_sampled > 0 && e.avg_duration_ms !== null;
}

export interface AggregateEstimate {
  durationMs: number | null;
  costUsd: number | null;
  counted: number;
}

/** Aggregate the selected agents' estimates for the "Run multi-agent review"
 *  action line: MAX of durations (parallel fan-out — the group finishes when
 *  its slowest agent does) and SUM of costs (every agent's own LLM spend adds
 *  up). Agents without history are excluded entirely; if none of the selected
 *  agents has history, both figures are null (AC-9/AC-10). */
export function aggregateEstimate(
  estimates: AgentRunEstimate[],
  selectedIds: string[]
): AggregateEstimate {
  const withHistory = selectedIds
    .map((id) => estimateFor(estimates, id))
    .filter((e): e is AgentRunEstimate => hasHistory(e));

  if (withHistory.length === 0) {
    return { durationMs: null, costUsd: null, counted: 0 };
  }

  const durationMs = Math.max(...withHistory.map((e) => e.avg_duration_ms as number));
  const costs = withHistory
    .map((e) => e.avg_cost_usd)
    .filter((c): c is number => c !== null);
  const costUsd = costs.length > 0 ? costs.reduce((a, b) => a + b, 0) : null;

  return { durationMs, costUsd, counted: withHistory.length };
}

/** e.g. "8.2s"; "—" when unknown. */
export function formatDuration(ms: number | null): string {
  if (ms === null) return "—";
  return `${(ms / 1000).toFixed(1)}s`;
}

/** e.g. "$0.20"; "—" when unknown. */
export function formatCost(usd: number | null): string {
  if (usd === null) return "—";
  return `$${usd.toFixed(2)}`;
}
