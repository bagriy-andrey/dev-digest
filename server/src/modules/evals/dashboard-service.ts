import type { Container } from '../../platform/container.js';
import type { AgentRow } from '../../db/rows.js';
import {
  AgentVersionConfig,
  EvalRunDetail,
  type EvalAgentRow,
  type EvalBatchSummary,
  type EvalCompare,
  type EvalDashboard,
  type EvalRunCounts,
  type EvalRunRecord,
  type EvalWorkspaceDashboard,
} from '@devdigest/shared';
import { AppError } from '../../platform/errors.js';
import { EvalsRepository } from './repository.js';
import { aggregateBatch } from './scorer.js';
import { MAX_RECENT_BATCHES, MAX_RECENT_RUNS, TREND_WINDOW_BATCHES } from './constants.js';
import * as batchRegistry from './batch-registry.js';

const ZERO_COUNTS: EvalRunCounts = { must_find: 0, matched: 0, actual: 0, noise: 0, dropped: 0 };

/**
 * Read-only aggregation (SPEC-03 step 4). No writes anywhere in this file.
 */
export class EvalDashboardService {
  private repo: EvalsRepository;

  constructor(private container: Container) {
    this.repo = new EvalsRepository(container.db);
  }

  /**
   * A single batch's summary + its per-case runs, workspace-scoped. There is
   * no `workspace_id` column on `eval_runs`/batches, so scoping happens by
   * resolving the batch's first run's CASE through the workspace-scoped
   * `getCase` — if that fails (wrong workspace, or the case was deleted),
   * the batch is treated as not found, exactly like any other cross-tenant
   * lookup miss.
   */
  async batchSummary(
    workspaceId: string,
    batchId: string,
  ): Promise<{ summary: EvalBatchSummary; runs: EvalRunRecord[] } | undefined> {
    const runs = await this.repo.runsForBatch(batchId);
    if (runs.length === 0) return undefined;
    const anchorCase = await this.repo.getCase(workspaceId, runs[0]!.case_id);
    if (!anchorCase) return undefined;
    const agent = await this.container.agentsRepo.getById(workspaceId, anchorCase.owner_id);
    if (!agent) return undefined;
    return { summary: this.buildSummary(batchId, agent, runs), runs };
  }

  /** Per-agent dashboard (AC-33): current + delta + trend + recent runs/batches. */
  async agentDashboard(workspaceId: string, agentId: string): Promise<EvalDashboard | undefined> {
    const agent = await this.container.agentsRepo.getById(workspaceId, agentId);
    if (!agent) return undefined;

    const casesTotal = await this.repo.countByOwner(workspaceId, 'agent', agentId);
    const batchWindow = Math.max(TREND_WINDOW_BATCHES, MAX_RECENT_BATCHES);
    // Newest-first distinct batch ids for this agent.
    const batchIds = await this.repo.batchesForOwner(workspaceId, agentId, batchWindow);

    const summaries: EvalBatchSummary[] = [];
    for (const batchId of batchIds) {
      const runs = await this.repo.runsForBatch(batchId);
      if (runs.length === 0) continue;
      summaries.push(this.buildSummary(batchId, agent, runs));
    }

    // A batch that's running but hasn't written a row yet is absent from
    // `summaries` (built only from `runsForBatch`) — surface it separately so
    // `recent_batches` reflects it without disturbing `current`/`delta`/
    // `trend`, which stay anchored to the last real (row-backed) batches.
    const runningId = batchRegistry.runningBatchId(agentId);
    const runningVisible = summaries.some((s) => s.batch_id === runningId);
    const recentBatches = (
      runningId && !runningVisible
        ? [this.runningPlaceholder(agent, runningId, casesTotal), ...summaries]
        : summaries
    ).slice(0, MAX_RECENT_BATCHES);
    // Trend is chronological (oldest → newest), bounded to TREND_WINDOW_BATCHES.
    const trend = summaries
      .slice(0, TREND_WINDOW_BATCHES)
      .slice()
      .reverse()
      .map((s) => ({
        ran_at: s.ran_at,
        recall: s.recall,
        precision: s.precision,
        citation_accuracy: s.citation_accuracy,
        pass_rate: s.cases_total === 0 ? 0 : s.cases_passed / s.cases_total,
        cost_usd: s.cost_usd,
      }));

    const latest = summaries[0];
    const previous = summaries[1];

    const current = {
      recall: latest?.recall ?? 0,
      precision: latest?.precision ?? 0,
      citation_accuracy: latest?.citation_accuracy ?? 0,
      traces_passed: latest?.cases_passed ?? 0,
      traces_total: latest?.cases_total ?? 0,
      cost_usd: latest?.cost_usd ?? null,
    };
    const delta = {
      recall: latest && previous ? latest.recall - previous.recall : 0,
      precision: latest && previous ? latest.precision - previous.precision : 0,
      citation_accuracy: latest && previous ? latest.citation_accuracy - previous.citation_accuracy : 0,
    };

    const recentRuns = await this.repo.runsForOwner(workspaceId, agentId, { limit: MAX_RECENT_RUNS });

    return {
      owner_kind: 'agent',
      owner_id: agentId,
      cases_total: casesTotal,
      current,
      delta,
      trend,
      recent_runs: recentRuns,
      recent_batches: recentBatches,
      // D2 — the "largest movement" summary sentence is a CLIENT pure function
      // (i18n reasons); the server never composes an English sentence.
      alert: null,
    };
  }

  /** Workspace-wide dashboard (AC-35): one row per enabled agent + a flat run list. */
  async workspaceDashboard(workspaceId: string): Promise<EvalWorkspaceDashboard> {
    const agents = await this.container.agentsRepo.listEnabled(workspaceId);
    const caseCounts = await this.repo.caseCountsByOwner(workspaceId);
    const countFor = (ownerId: string) =>
      caseCounts.find((c) => c.ownerKind === 'agent' && c.ownerId === ownerId)?.count ?? 0;

    const agentRows: EvalAgentRow[] = [];
    for (const agent of agents) {
      const casesTotal = countFor(agent.id);
      const batchIds = await this.repo.batchesForOwner(workspaceId, agent.id, TREND_WINDOW_BATCHES);
      const summaries: EvalBatchSummary[] = [];
      for (const batchId of batchIds) {
        const runs = await this.repo.runsForBatch(batchId);
        if (runs.length === 0) continue;
        summaries.push(this.buildSummary(batchId, agent, runs));
      }
      const runningId = batchRegistry.runningBatchId(agent.id);
      const lastBatch =
        runningId && !summaries.some((s) => s.batch_id === runningId)
          ? this.runningPlaceholder(agent, runningId, casesTotal)
          : (summaries[0] ?? null);
      agentRows.push({
        agent_id: agent.id,
        agent_name: agent.name,
        provider: agent.provider,
        model: agent.model,
        enabled: agent.enabled,
        cases_total: casesTotal,
        last_batch: lastBatch,
        recall_trend: summaries
          .slice()
          .reverse()
          .map((s) => s.recall),
      });
    }

    const allRuns = await this.repo.recentRunsForWorkspace(workspaceId, MAX_RECENT_RUNS);
    const agg = aggregateBatch(allRuns.map((r) => this.parseDetail(r.actual_output).counts));
    const casesPassed = allRuns.filter((r) => r.pass === true).length;
    const costs = allRuns.map((r) => r.cost_usd).filter((c): c is number => c != null);

    const workspace: EvalDashboard = {
      owner_kind: null,
      owner_id: null,
      cases_total: caseCounts.reduce((sum, c) => sum + c.count, 0),
      current: {
        recall: agg.recall,
        precision: agg.precision,
        citation_accuracy: agg.citation_accuracy,
        traces_passed: casesPassed,
        traces_total: allRuns.length,
        cost_usd: costs.length > 0 ? costs.reduce((a, b) => a + b, 0) : null,
      },
      delta: { recall: 0, precision: 0, citation_accuracy: 0 },
      trend: [],
      recent_runs: allRuns,
      recent_batches: [],
      alert: null,
    };

    return { workspace, agents: agentRows };
  }

  /** Compare two batches of the SAME agent (AC-26/28/29). */
  async compare(workspaceId: string, batchIdA: string, batchIdB: string): Promise<EvalCompare | undefined> {
    const a = await this.batchSummary(workspaceId, batchIdA);
    const b = await this.batchSummary(workspaceId, batchIdB);
    if (!a || !b) return undefined;
    if (a.summary.agent_id !== b.summary.agent_id) {
      throw new AppError('validation_error', 'The two batches belong to different agents', 422);
    }

    // Order older → newer by ran_at (AC-26), independent of which the caller
    // labelled `a`/`b` in the query string.
    const [older, newer] =
      a.summary.ran_at <= b.summary.ran_at ? [a, b] : [b, a];

    const [caseIdsOlder, caseIdsNewer] = await Promise.all([
      this.repo.caseIdsInBatch(older.summary.batch_id),
      this.repo.caseIdsInBatch(newer.summary.batch_id),
    ]);
    const casesOnlyInA = [...caseIdsOlder].filter((id) => !caseIdsNewer.has(id)).length;
    const casesOnlyInB = [...caseIdsNewer].filter((id) => !caseIdsOlder.has(id)).length;

    const systemPromptFor = async (version: number | null): Promise<string | null> => {
      // AC-28 — null when that side's agent_version is null; degrade gracefully.
      if (version == null) return null;
      const versionRow = await this.container.agentsRepo.getVersion(older.summary.agent_id, version);
      if (!versionRow) return null;
      const parsed = AgentVersionConfig.safeParse(versionRow.configJson);
      return parsed.success ? parsed.data.system_prompt : null;
    };

    const [systemPromptA, systemPromptB] = await Promise.all([
      systemPromptFor(older.summary.agent_version),
      systemPromptFor(newer.summary.agent_version),
    ]);

    return {
      agent_id: older.summary.agent_id,
      a: older.summary,
      b: newer.summary,
      delta: {
        recall: newer.summary.recall - older.summary.recall,
        precision: newer.summary.precision - older.summary.precision,
        citation_accuracy: newer.summary.citation_accuracy - older.summary.citation_accuracy,
        cost_usd:
          newer.summary.cost_usd != null && older.summary.cost_usd != null
            ? newer.summary.cost_usd - older.summary.cost_usd
            : null,
      },
      system_prompt_a: systemPromptA,
      system_prompt_b: systemPromptB,
      cases_only_in_a: casesOnlyInA,
      cases_only_in_b: casesOnlyInB,
    };
  }

  // ---- helpers --------------------------------------------------------

  private parseDetail(raw: unknown): { counts: EvalRunCounts } {
    const parsed = EvalRunDetail.safeParse(raw);
    if (parsed.success) return { counts: parsed.data.counts };
    return { counts: { ...ZERO_COUNTS } };
  }

  /**
   * Pool `actual_output.counts` across a batch's rows (D3 — micro-averaged,
   * NEVER the mean of each row's own recall/precision/citation_accuracy).
   */
  private buildSummary(batchId: string, agent: AgentRow, runs: EvalRunRecord[]): EvalBatchSummary {
    const counts = runs.map((r) => this.parseDetail(r.actual_output).counts);
    const agg = aggregateBatch(counts);
    const casesPassed = runs.filter((r) => r.pass === true).length;
    const durationMs = runs.reduce((sum, r) => sum + (r.duration_ms ?? 0), 0);
    const costs = runs.map((r) => r.cost_usd).filter((c): c is number => c != null);
    const costUsd = costs.length > 0 ? costs.reduce((sum, c) => sum + c, 0) : null;
    // runsForBatch orders newest-first, so runs[0] carries the batch's most
    // recent timestamp and every row shares the same agent_version (AC-22).
    const ranAt = runs[0]!.ran_at;
    const agentVersion = runs[0]!.agent_version;

    return {
      batch_id: batchId,
      agent_id: agent.id,
      agent_name: agent.name,
      agent_version: agentVersion,
      ran_at: ranAt,
      cases_total: runs.length,
      cases_passed: casesPassed,
      recall: agg.recall,
      precision: agg.precision,
      citation_accuracy: agg.citation_accuracy,
      recall_na: agg.recall_na,
      precision_na: agg.precision_na,
      citation_accuracy_na: agg.citation_accuracy_na,
      cost_usd: costUsd,
      duration_ms: durationMs,
      status: batchRegistry.runningBatchId(agent.id) === batchId ? 'running' : 'complete',
    };
  }

  /**
   * A batch is registered in `batchRegistry` the instant it's triggered, but
   * writes its first `eval_runs` row only once its FIRST case finishes (real
   * LLM calls — can take seconds). Until then it has zero rows and is
   * invisible to `runsForBatch`/`batchesForOwner`, so the dashboard would
   * show no "running" indicator at all — while the server correctly 409s a
   * second trigger attempt (AC-23) — leaving the UI looking idle while it's
   * actually busy. This synthesizes a zero-progress placeholder so the
   * running batch is visible immediately, not just once its first row lands.
   */
  private runningPlaceholder(agent: AgentRow, batchId: string, casesTotal: number): EvalBatchSummary {
    return {
      batch_id: batchId,
      agent_id: agent.id,
      agent_name: agent.name,
      agent_version: agent.version,
      ran_at: new Date().toISOString(),
      cases_total: casesTotal,
      cases_passed: 0,
      recall: 1,
      precision: 1,
      citation_accuracy: 1,
      recall_na: true,
      precision_na: true,
      citation_accuracy_na: true,
      cost_usd: null,
      duration_ms: 0,
      status: 'running',
    };
  }
}
