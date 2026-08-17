/* Pure helpers for the Multi-Agent Review results page. No I/O — hermetically
   unit-testable (see PLAN-04 D9 / AC-30). */
import type { Conflict, FindingRecord, ReviewRecord } from "@/lib/types";

/**
 * A conflict group is "divergent" (worth surfacing under the "Show only
 * conflicts" filter) when either:
 *  - at least one participating agent flagged it (a severity take) and at
 *    least one other agent reviewed the location and chose not to flag it
 *    ('ignored'), OR
 *  - the agents that DID flag it disagree on severity (2+ distinct
 *    severities among the non-ignored takes).
 * A group where every take shares the same severity (full agreement) is NOT
 * divergent — it still renders in the widened set (server AC-46) but is
 * hidden once the toggle is on.
 */
export function isDivergent(conflict: Conflict): boolean {
  const verdicts = conflict.takes.map((take) => take.verdict);
  const hasIgnored = verdicts.includes("ignored");
  const severities = new Set(verdicts.filter((v) => v !== "ignored"));
  if (hasIgnored && severities.size >= 1) return true;
  return severities.size >= 2;
}

/** All persisted findings for one run (for the trace drawer's Findings
 *  section) — `[]` when the run has no matching review yet (e.g. still
 *  running, or the reviews list hasn't loaded). */
export function findingsForRun(
  reviews: ReviewRecord[] | undefined,
  runId: string
): FindingRecord[] {
  return reviews?.find((r) => r.run_id === runId)?.findings ?? [];
}
