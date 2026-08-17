import type {
  AgentColumn,
  AgentColumnFinding,
  AgentRunEstimate,
  MultiAgentGroupSummary,
  MultiAgentRun,
  RunRequest,
  Severity,
} from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { NotFoundError } from '../../platform/errors.js';
import type { Logger } from '../reviews/run-executor.js';
import { ReviewRepository } from '../reviews/repository.js';
import { ReviewService } from '../reviews/service.js';
import { MultiAgentRepository } from './repository.js';
import {
  averageEstimates,
  columnSummary,
  computeConflicts,
  mapRunStatus,
  sortFindingsBySeverity,
  totalsFor,
  type GroupAgent,
  type GroupFinding,
} from './helpers.js';

export type { Logger };

/**
 * Multi-Agent Review — orchestration (SPEC-04 §1C). Composes the sibling
 * `ReviewService` (kick-off + agent resolution) and its own `MultiAgentRepository`
 * (the group read model). Each sibling is stored as an instance field —
 * NOT `new`'d inline per call — so this service is hermetically testable by
 * post-construction stubbing (mirrors `BriefService`).
 */
export class MultiAgentService {
  private repo: MultiAgentRepository;
  private reviews: ReviewService;
  private agents: Container['agentsRepo'];
  private reviewRepo: ReviewRepository;

  constructor(private container: Container) {
    this.repo = new MultiAgentRepository(container.db);
    this.reviews = new ReviewService(container);
    this.agents = container.agentsRepo;
    this.reviewRepo = new ReviewRepository(container.db);
  }

  /**
   * Kick off a group run (AC-13…AC-18). All-or-nothing: `resolveTargets`
   * throws BEFORE any row is created on an unknown agent id or an
   * empty/absent selection. The response is built deterministically from the
   * just-created rows (D13) — never re-read from the DB, so it can't race a
   * background run that finishes before this method returns.
   */
  async start(workspaceId: string, prId: string, body: RunRequest, logger?: Logger): Promise<MultiAgentRun> {
    const pull = await this.reviewRepo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');

    const targets = await this.reviews.resolveTargets(workspaceId, {
      ...(body.agentId !== undefined ? { agentId: body.agentId } : {}),
      ...(body.all !== undefined ? { all: body.all } : {}),
      ...(body.agentIds !== undefined ? { agentIds: body.agentIds } : {}),
    });

    const group = await this.repo.createGroup(workspaceId, prId);

    const { runs } = await this.reviews.runReview(workspaceId, prId, targets, logger, {
      multiAgentRunId: group.id,
    });

    logger?.info(
      { groupId: group.id, prId, agentIds: targets.map((a) => a.id), agentCount: targets.length },
      'multi-agent: group started',
    );

    const columns: AgentColumn[] = runs.map((r) => ({
      run_id: r.run_id,
      agent_id: r.agent_id,
      agent_name: r.agent_name,
      provider: null,
      model: null,
      status: 'running',
      verdict: null,
      score: null,
      summary: null,
      duration_ms: null,
      cost_usd: null,
      findings: [],
    }));

    return {
      id: group.id,
      pr_id: prId,
      pr_number: pull.number,
      ran_at: group.ranAt.toISOString(),
      agent_count: columns.length,
      total_duration_ms: 0,
      total_cost_usd: null,
      columns,
      conflicts: [],
    };
  }

  /**
   * The latest group for a PR, fully composed: columns (status/verdict/
   * findings from `agent_runs` + `reviews` + `findings`), conflicts computed
   * fresh on every read, and totals honest under parallel fan-out (AC-22…AC-26,
   * AC-46). `null` when the PR has never had a group run (D7) — never 404.
   */
  async latest(workspaceId: string, prId: string, logger?: Logger): Promise<MultiAgentRun | null> {
    const pull = await this.reviewRepo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');

    const group = await this.repo.latestGroupForPull(workspaceId, prId);
    if (!group) return null;

    return this.composeGroup(prId, pull.number, group, logger);
  }

  /**
   * The most recently started groups anywhere in the workspace (any PR),
   * lightweight (no columns/conflicts) — backs the Multi-Agent Review page's
   * "recent runs" landing list, so reopening the page shows real history
   * instead of forcing a fresh Configure-run every visit.
   */
  async recentForWorkspace(workspaceId: string, limit: number, logger?: Logger): Promise<MultiAgentGroupSummary[]> {
    const rows = await this.repo.recentGroupsForWorkspace(workspaceId, limit);
    logger?.info({ workspaceId, count: rows.length }, 'multi-agent: recent groups read');
    return rows.map((r) => ({
      id: r.id,
      pr_id: r.prId,
      pr_number: r.prNumber,
      pr_title: r.prTitle,
      ran_at: r.ranAt.toISOString(),
      agent_count: r.agentCount,
      status: r.runningCount > 0 ? 'running' : r.doneCount > 0 ? 'done' : 'failed',
      total_duration_ms: r.totalDurationMs,
      total_cost_usd: r.totalCostUsd,
    }));
  }

  /** Shared read-model composition for `latest`/`latestForWorkspace` — columns
   *  (status/verdict/findings from `agent_runs` + `reviews` + `findings`),
   *  conflicts computed fresh, totals honest under parallel fan-out. */
  private async composeGroup(
    prId: string,
    prNumber: number,
    group: { id: string; ranAt: Date },
    logger?: Logger,
  ): Promise<MultiAgentRun> {
    const runs = await this.repo.runsForGroup(group.id);
    const runIds = runs.map((r) => r.run_id);
    const [reviews, findings] = await Promise.all([this.repo.reviewsForRuns(runIds), this.repo.findingsForRuns(runIds)]);

    const reviewsByRun = new Map(reviews.map((r) => [r.run_id, r]));
    const findingsByRun = new Map<string, typeof findings>();
    for (const f of findings) {
      const bucket = findingsByRun.get(f.run_id);
      if (bucket) bucket.push(f);
      else findingsByRun.set(f.run_id, [f]);
    }

    const columns: AgentColumn[] = runs.map((r) => {
      const review = reviewsByRun.get(r.run_id);
      const runFindings: AgentColumnFinding[] = (findingsByRun.get(r.run_id) ?? []).map((f) => ({
        id: f.id,
        severity: f.severity as Severity,
        category: f.category,
        title: f.title,
        file: f.file,
        start_line: f.start_line,
      }));
      return {
        run_id: r.run_id,
        agent_id: r.agent_id ?? '',
        agent_name: r.agent_name ?? 'Unknown agent',
        provider: r.provider,
        model: r.model,
        status: mapRunStatus(r.status),
        verdict: review?.verdict ?? null,
        score: review?.score ?? null,
        summary: columnSummary(review?.summary ?? null, r.status, r.error),
        duration_ms: r.duration_ms,
        cost_usd: r.cost_usd,
        findings: sortFindingsBySeverity(runFindings),
      };
    });

    // Findings are grouped by their run above, so per-finding agent
    // attribution here is structural and lossless (AC-25).
    const allFindings: GroupFinding[] = findings.map((f) => ({
      agent_id: f.agent_id ?? '',
      id: f.id,
      severity: f.severity as Severity,
      title: f.title,
      file: f.file,
      start_line: f.start_line,
      end_line: f.end_line,
    }));
    const groupAgents: GroupAgent[] = columns.map((c) => ({ agent_id: c.agent_id, agent_name: c.agent_name, status: c.status }));
    const conflicts = computeConflicts(allFindings, groupAgents);

    const totals = totalsFor(columns, group.ranAt, Date.now());
    const terminal = columns.every((c) => c.status !== 'running');
    logger?.info(
      { groupId: group.id, prId, agentCount: columns.length, terminal, totalCostUsd: totals.total_cost_usd },
      'multi-agent: group read',
    );

    return {
      id: group.id,
      pr_id: prId,
      pr_number: prNumber,
      ran_at: group.ranAt.toISOString(),
      agent_count: columns.length,
      total_duration_ms: totals.total_duration_ms,
      total_cost_usd: totals.total_cost_usd,
      columns,
      conflicts,
    };
  }

  /** Pre-run per-agent estimates (AC-8/AC-9). One query, no cache, no LLM. */
  async estimates(workspaceId: string): Promise<AgentRunEstimate[]> {
    const [rows, agentRows] = await Promise.all([this.repo.recentCompletedRuns(workspaceId), this.agents.list(workspaceId)]);
    return averageEstimates(rows, agentRows.map((a) => ({ id: a.id, name: a.name })));
  }
}
