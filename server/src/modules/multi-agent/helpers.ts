import type { AgentColumn, AgentColumnFinding, AgentRunEstimate, Conflict, ConflictTake, Severity } from '@devdigest/shared';
import { ESTIMATE_SAMPLE_SIZE, SEVERITY_RANK } from './constants.js';

/**
 * Multi-Agent Review — pure helpers (SPEC-04 §1C). No I/O, no drizzle, no
 * fastify: hermetically unit-testable. This is where every deterministic
 * rule of the feature lives (status mapping, conflict detection, estimate
 * averaging, totals).
 */

/** An agent participating in a group, reduced to what conflict-detection needs. */
export type GroupAgent = { agent_id: string; agent_name: string; status: 'done' | 'running' | 'failed' };

/** A persisted finding, reduced to what conflict-detection needs. */
export type GroupFinding = {
  agent_id: string;
  id: string;
  severity: Severity;
  title: string;
  file: string;
  start_line: number;
  end_line: number;
};

/** Map a raw `agent_runs.status` string to the multi-agent column's tri-state (AC-23). */
export function mapRunStatus(dbStatus: string | null): 'done' | 'running' | 'failed' {
  if (dbStatus === 'done') return 'done';
  if (dbStatus === 'running') return 'running';
  // 'failed' | 'cancelled' | anything else (defensive) all collapse to 'failed'.
  return 'failed';
}

/**
 * The text shown under a column: the review's own summary for a healthy run;
 * the failure/cancellation reason for a failed or cancelled run (D5, AC-20/AC-23)
 * — `AgentColumn` has no dedicated `error` field, so this overloads `summary`.
 */
export function columnSummary(reviewSummary: string | null, dbStatus: string | null, error: string | null): string | null {
  if (dbStatus === 'failed') return error;
  if (dbStatus === 'cancelled') return error ?? 'Cancelled by user';
  return reviewSummary;
}

/** Severity desc, then file, then start_line — stable and deterministic (AC-34). */
export function sortFindingsBySeverity(findings: AgentColumnFinding[]): AgentColumnFinding[] {
  return [...findings].sort((a, b) => {
    const rankDiff = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
    if (rankDiff !== 0) return rankDiff;
    const fileDiff = a.file.localeCompare(b.file);
    if (fileDiff !== 0) return fileDiff;
    return a.start_line - b.start_line;
  });
}

/** True when `b` outranks (or ties-and-comes-before) `a` by (severity desc, start_line asc). */
function outranks(a: { severity: Severity; start_line: number }, b: { severity: Severity; start_line: number }): boolean {
  const rankA = SEVERITY_RANK[a.severity];
  const rankB = SEVERITY_RANK[b.severity];
  if (rankB !== rankA) return rankB > rankA;
  return b.start_line < a.start_line;
}

/**
 * "Where agents disagree" (AC-26…AC-31, AC-46). Pure function of persisted
 * findings + participating agents; makes no call, persists nothing.
 */
export function computeConflicts(findings: GroupFinding[], agents: GroupAgent[]): Conflict[] {
  // A failed/cancelled/still-running agent "reviewed and chose not to flag"
  // has no meaning (D10) — only agents that actually finished participate.
  const participants = agents.filter((a) => a.status === 'done');
  if (participants.length < 2) return [];

  // Bound the whole rule to per-file: everything below never crosses files.
  const byFile = new Map<string, GroupFinding[]>();
  for (const f of findings) {
    const bucket = byFile.get(f.file);
    if (bucket) bucket.push(f);
    else byFile.set(f.file, [f]);
  }

  const conflicts: Conflict[] = [];

  for (const [file, fileFindings] of byFile) {
    const sorted = [...fileFindings].sort((a, b) => a.start_line - b.start_line || a.end_line - b.end_line);

    // Sweep-merge into clusters of overlapping [start_line, end_line] ranges.
    // Adjacent-but-disjoint ranges (e.g. 10-12 vs 13-15) deliberately do NOT merge.
    const clusters: GroupFinding[][] = [];
    let current: GroupFinding[] = [];
    let maxEnd = -Infinity;
    for (const f of sorted) {
      if (current.length > 0 && f.start_line <= maxEnd) {
        current.push(f);
        maxEnd = Math.max(maxEnd, f.end_line);
      } else {
        if (current.length > 0) clusters.push(current);
        current = [f];
        maxEnd = f.end_line;
      }
    }
    if (current.length > 0) clusters.push(current);

    for (const cluster of clusters) {
      // One take per agent: keep only its highest-severity finding in this
      // cluster (tie → lowest start_line) — an agent that flagged the same
      // location twice still produces exactly one take.
      const flaggers = new Map<string, GroupFinding>();
      for (const f of cluster) {
        const existing = flaggers.get(f.agent_id);
        if (!existing || outranks(existing, f)) flaggers.set(f.agent_id, f);
      }

      const takes: ConflictTake[] = participants.map((a) => {
        const flag = flaggers.get(a.agent_id);
        return flag
          ? { agent_id: a.agent_id, persona: a.agent_name, verdict: flag.severity, note: flag.title }
          : { agent_id: a.agent_id, persona: a.agent_name, verdict: 'ignored' as const, note: '' };
      });

      if (takes.length < 2) continue;

      let titleFinding = cluster[0]!;
      for (const f of cluster) {
        if (outranks(titleFinding, f)) titleFinding = f;
      }

      conflicts.push({
        file,
        line: Math.min(...cluster.map((f) => f.start_line)),
        title: titleFinding.title,
        takes,
      });
    }
  }

  return conflicts.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}

/**
 * Per-agent pre-run estimate (AC-8/AC-9): average `duration_ms`/`cost_usd`
 * over the last `ESTIMATE_SAMPLE_SIZE` completed runs (input already
 * newest-first). Every agent gets a row; zero history ⇒ `runs_sampled: 0`
 * and both averages `null` — never a global default, never a fabricated figure.
 */
export function averageEstimates(
  rows: { agent_id: string; duration_ms: number | null; cost_usd: number | null }[],
  agents: { id: string; name: string }[],
): AgentRunEstimate[] {
  const byAgent = new Map<string, typeof rows>();
  for (const row of rows) {
    const bucket = byAgent.get(row.agent_id);
    if (bucket) bucket.push(row);
    else byAgent.set(row.agent_id, [row]);
  }

  return agents.map((agent) => {
    const sample = (byAgent.get(agent.id) ?? []).slice(0, ESTIMATE_SAMPLE_SIZE);
    if (sample.length === 0) {
      return { agent_id: agent.id, agent_name: agent.name, runs_sampled: 0, avg_duration_ms: null, avg_cost_usd: null };
    }
    const durations = sample.map((r) => r.duration_ms).filter((v): v is number => v !== null);
    const costs = sample.map((r) => r.cost_usd).filter((v): v is number => v !== null);
    return {
      agent_id: agent.id,
      agent_name: agent.name,
      runs_sampled: sample.length,
      avg_duration_ms: durations.length > 0 ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null,
      avg_cost_usd: costs.length > 0 ? costs.reduce((a, b) => a + b, 0) / costs.length : null,
    };
  });
}

/**
 * Group totals (AC-24, D6). While any column is still `running`, duration is
 * the honest elapsed-since-group-start; once every column is terminal, it's
 * `max(duration_ms)` across columns — the flat wall clock under parallel
 * fan-out. Never blocks/awaits anything.
 */
export function totalsFor(
  columns: AgentColumn[],
  groupRanAt: Date,
  now: number,
): { total_duration_ms: number; total_cost_usd: number | null } {
  const costs = columns.map((c) => c.cost_usd).filter((v): v is number => v !== null);
  const total_cost_usd = costs.length > 0 ? costs.reduce((a, b) => a + b, 0) : null;

  const anyRunning = columns.some((c) => c.status === 'running');
  if (anyRunning) {
    return { total_duration_ms: now - groupRanAt.getTime(), total_cost_usd };
  }
  const durations = columns.map((c) => c.duration_ms ?? 0);
  return { total_duration_ms: durations.length > 0 ? Math.max(...durations) : 0, total_cost_usd };
}
