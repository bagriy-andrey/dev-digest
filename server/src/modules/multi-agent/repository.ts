import { and, count, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

/**
 * Multi-Agent Review — data access (SPEC-04 §1C). Drizzle only, workspace-scoped,
 * zero business logic (that's `helpers.ts`/`service.ts`).
 */

export interface GroupRunRow {
  run_id: string;
  agent_id: string | null;
  agent_name: string | null;
  provider: string | null;
  model: string | null;
  status: string | null;
  error: string | null;
  duration_ms: number | null;
  cost_usd: number | null;
  ran_at: Date;
}

export interface RunReviewRow {
  run_id: string;
  verdict: string | null;
  score: number | null;
  summary: string | null;
}

export interface RunFindingRow {
  run_id: string;
  agent_id: string | null;
  id: string;
  severity: string;
  category: string;
  title: string;
  file: string;
  start_line: number;
  end_line: number;
}

export interface RecentRunRow {
  agent_id: string;
  duration_ms: number | null;
  cost_usd: number | null;
  ran_at: Date;
}

export interface RecentGroupRow {
  id: string;
  prId: string;
  ranAt: Date;
  prNumber: number;
  prTitle: string;
  agentCount: number;
  runningCount: number;
  doneCount: number;
  totalDurationMs: number | null;
  totalCostUsd: number | null;
}

export class MultiAgentRepository {
  constructor(private db: Db) {}

  /** One `multi_agent_runs` insert (AC-15). */
  async createGroup(workspaceId: string, prId: string): Promise<{ id: string; ranAt: Date }> {
    const [row] = await this.db
      .insert(t.multiAgentRuns)
      .values({ workspaceId, prId })
      .returning({ id: t.multiAgentRuns.id, ranAt: t.multiAgentRuns.ranAt });
    return row!;
  }

  /** The most recent group started for a PR (AC-22). Workspace predicate is on
   *  the query itself — never derived from a bare group id (AC-16). */
  async latestGroupForPull(workspaceId: string, prId: string): Promise<{ id: string; ranAt: Date } | undefined> {
    const [row] = await this.db
      .select({ id: t.multiAgentRuns.id, ranAt: t.multiAgentRuns.ranAt })
      .from(t.multiAgentRuns)
      .where(and(eq(t.multiAgentRuns.workspaceId, workspaceId), eq(t.multiAgentRuns.prId, prId)))
      .orderBy(desc(t.multiAgentRuns.ranAt))
      .limit(1);
    return row;
  }

  /** The most recently started groups anywhere in the workspace, across
   *  every PR, aggregated (not fully composed — no columns/conflicts) for
   *  the "recent runs" landing list. One grouped query, no N+1: agent-run
   *  counts/statuses/totals are aggregated directly via SQL rather than
   *  looping `runsForGroup` per group. */
  async recentGroupsForWorkspace(workspaceId: string, limit: number): Promise<RecentGroupRow[]> {
    const rows = await this.db
      .select({
        id: t.multiAgentRuns.id,
        prId: t.multiAgentRuns.prId,
        ranAt: t.multiAgentRuns.ranAt,
        prNumber: t.pullRequests.number,
        prTitle: t.pullRequests.title,
        agentCount: count(t.agentRuns.id),
        // Cast to ::int — count()/count(*) is bigint (int8) in Postgres, which
        // the postgres-js driver returns as a string/BigInt unless narrowed;
        // an explicit cast keeps these as plain JS numbers like `count()`
        // (drizzle's own helper, used for `agentCount` above) already does.
        runningCount: sql<number>`count(*) filter (where ${t.agentRuns.status} = 'running')::int`,
        doneCount: sql<number>`count(*) filter (where ${t.agentRuns.status} = 'done')::int`,
        totalDurationMs: sql<number | null>`max(${t.agentRuns.durationMs})`,
        totalCostUsd: sql<number | null>`sum(${t.agentRuns.costUsd})`,
      })
      .from(t.multiAgentRuns)
      .innerJoin(t.pullRequests, eq(t.pullRequests.id, t.multiAgentRuns.prId))
      .leftJoin(t.agentRuns, eq(t.agentRuns.multiAgentRunId, t.multiAgentRuns.id))
      .where(eq(t.multiAgentRuns.workspaceId, workspaceId))
      .groupBy(t.multiAgentRuns.id, t.pullRequests.number, t.pullRequests.title)
      .orderBy(desc(t.multiAgentRuns.ranAt))
      .limit(limit);
    return rows;
  }

  /** Every run belonging to a group, ordered by agent name for a stable column order. */
  async runsForGroup(groupId: string): Promise<GroupRunRow[]> {
    const rows = await this.db
      .select({
        id: t.agentRuns.id,
        agentId: t.agentRuns.agentId,
        agentName: t.agents.name,
        provider: t.agentRuns.provider,
        model: t.agentRuns.model,
        status: t.agentRuns.status,
        error: t.agentRuns.error,
        durationMs: t.agentRuns.durationMs,
        costUsd: t.agentRuns.costUsd,
        ranAt: t.agentRuns.ranAt,
      })
      .from(t.agentRuns)
      .leftJoin(t.agents, eq(t.agents.id, t.agentRuns.agentId))
      .where(eq(t.agentRuns.multiAgentRunId, groupId))
      .orderBy(t.agents.name);
    return rows.map((r) => ({
      run_id: r.id,
      agent_id: r.agentId,
      agent_name: r.agentName,
      provider: r.provider,
      model: r.model,
      status: r.status,
      error: r.error,
      duration_ms: r.durationMs,
      cost_usd: r.costUsd,
      ran_at: r.ranAt,
    }));
  }

  /** The newest review per run id (in practice one review per run). */
  async reviewsForRuns(runIds: string[]): Promise<RunReviewRow[]> {
    if (runIds.length === 0) return [];
    const rows = await this.db
      .select({
        runId: t.reviews.runId,
        verdict: t.reviews.verdict,
        score: t.reviews.score,
        summary: t.reviews.summary,
        createdAt: t.reviews.createdAt,
      })
      .from(t.reviews)
      .where(inArray(t.reviews.runId, runIds))
      .orderBy(desc(t.reviews.createdAt));
    const byRun = new Map<string, RunReviewRow>();
    for (const r of rows) {
      if (!r.runId || byRun.has(r.runId)) continue;
      byRun.set(r.runId, { run_id: r.runId, verdict: r.verdict, score: r.score, summary: r.summary });
    }
    return [...byRun.values()];
  }

  /** `findings` has no `run_id`/`pr_id` column — join through `reviews`. */
  async findingsForRuns(runIds: string[]): Promise<RunFindingRow[]> {
    if (runIds.length === 0) return [];
    const rows = await this.db
      .select({
        runId: t.reviews.runId,
        agentId: t.reviews.agentId,
        id: t.findings.id,
        severity: t.findings.severity,
        category: t.findings.category,
        title: t.findings.title,
        file: t.findings.file,
        startLine: t.findings.startLine,
        endLine: t.findings.endLine,
      })
      .from(t.findings)
      .innerJoin(t.reviews, eq(t.findings.reviewId, t.reviews.id))
      .where(inArray(t.reviews.runId, runIds));
    return rows.map((r) => ({
      run_id: r.runId!,
      agent_id: r.agentId,
      id: r.id,
      severity: r.severity,
      category: r.category,
      title: r.title,
      file: r.file,
      start_line: r.startLine,
      end_line: r.endLine,
    }));
  }

  /** Workspace-wide, newest-first, one query — the per-agent "last 5" slice
   *  happens in `averageEstimates` (AC-8). Any PR, any repo, zero LLM calls. */
  async recentCompletedRuns(workspaceId: string): Promise<RecentRunRow[]> {
    const rows = await this.db
      .select({ agentId: t.agentRuns.agentId, durationMs: t.agentRuns.durationMs, costUsd: t.agentRuns.costUsd, ranAt: t.agentRuns.ranAt })
      .from(t.agentRuns)
      .where(and(eq(t.agentRuns.workspaceId, workspaceId), eq(t.agentRuns.status, 'done'), isNotNull(t.agentRuns.agentId)))
      .orderBy(desc(t.agentRuns.ranAt));
    return rows.map((r) => ({ agent_id: r.agentId!, duration_ms: r.durationMs, cost_usd: r.costUsd, ran_at: r.ranAt }));
  }
}
