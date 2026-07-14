/**
 * `cli/format.ts` — pure terminal rendering + exit-code policy for the
 * `devdigest review` CLI (spec §1.B). No I/O: takes an `AgentReviewResult[]`
 * (already fetched from `POST /repos/:id/review-diff`) and returns a plain
 * string, or a boolean gate. Fully unit-testable in isolation from `cli/
 * review.ts`'s orchestration and I/O.
 */

import type { AgentReviewResult, ReviewDiffFinding } from '../api/types.js';

/** Render order for findings within one agent's block — CRITICAL first. */
export const SEVERITY_ORDER = ['CRITICAL', 'WARNING', 'SUGGESTION'] as const;

function formatFinding(finding: ReviewDiffFinding): string {
  return [`    ${finding.file}:${finding.start_line} — ${finding.title}`, `      ${finding.rationale}`].join('\n');
}

function formatAgentBlock(result: AgentReviewResult): string {
  const header = `${result.agent.name} — ${result.verdict}, score ${result.score}, blockers ${result.blockers}`;

  if (result.findings.length === 0) {
    return `${header}\n  No findings.`;
  }

  const bySeverity = new Map<string, ReviewDiffFinding[]>();
  for (const finding of result.findings) {
    const bucket = bySeverity.get(finding.severity) ?? [];
    bucket.push(finding);
    bySeverity.set(finding.severity, bucket);
  }

  const sections: string[] = [];
  for (const severity of SEVERITY_ORDER) {
    const findings = bySeverity.get(severity);
    if (!findings || findings.length === 0) continue;
    sections.push(`  ${severity}:`, ...findings.map((f) => formatFinding(f)));
  }

  // Any severity not in SEVERITY_ORDER (defensive — the contract only emits
  // the three above, but nothing enforces that at this layer) is rendered
  // last rather than silently dropped.
  for (const [severity, findings] of bySeverity) {
    if ((SEVERITY_ORDER as readonly string[]).includes(severity)) continue;
    sections.push(`  ${severity}:`, ...findings.map((f) => formatFinding(f)));
  }

  return [header, ...sections].join('\n');
}

/**
 * Renders the full CLI report: one block per agent, findings grouped by
 * severity (`SEVERITY_ORDER`), each finding as `file:start_line` + title +
 * rationale. A clean agent (no findings) renders a one-line "no findings".
 */
export function formatResults(results: AgentReviewResult[]): string {
  return results.map((r) => formatAgentBlock(r)).join('\n\n');
}

/**
 * The exit-code gate: non-zero iff ANY agent's server-computed `blockers`
 * count is positive. This reuses the server-computed gate (per-agent
 * `ciFailOn`), not a client-side severity re-derivation (spec §0 gotchas).
 */
export function hasBlockingFindings(results: AgentReviewResult[]): boolean {
  return results.some((r) => r.blockers > 0);
}
