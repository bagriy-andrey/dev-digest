import type { AgentReviewResult } from '@devdigest/shared';
import { countBlockers } from '@devdigest/reviewer-core';
import type { Container } from '../../platform/container.js';
import { AppError, NotFoundError } from '../../platform/errors.js';
import { RepoRepository } from '../repos/repository.js';
import { parseUnifiedDiff } from '../../adapters/git/diff-parser.js';
import { runAgentReview } from './agent-runner.js';
import { workingTreeTaskLine } from './helpers.js';
import type { Logger } from './run-executor.js';

/**
 * Pre-push CLI's review endpoint. Synchronous, unpersisted: runs every
 * enabled agent against a raw local working-tree diff (no PR behind it) and
 * returns the grounded results directly — no `agent_runs`/`reviews`/
 * `findings`/`run_traces` rows, no runBus/SSE. Mirrors `IntentService`'s DI
 * shape (news up its own repository from `container.db`).
 *
 * Reuses the exact same agent pipeline as the PR page via `runAgentReview`
 * (the shared, behaviour-preserving extraction) — same agents, same logic,
 * zero duplication.
 */
export class ReviewDiffService {
  private repos: RepoRepository;

  constructor(private container: Container) {
    this.repos = new RepoRepository(container.db);
  }

  /**
   * Run every enabled agent in `workspaceId` against `diff`, sequentially
   * (mirrors the PR executor's sequential loop — avoids a fan-out cost/rate
   * spike). Per-agent failures are isolated (logged, skipped); a 502 is
   * thrown only when EVERY agent failed, so the caller sees a failure rather
   * than a misleading empty-200.
   */
  async run(
    workspaceId: string,
    repoId: string,
    diff: string,
    logger?: Logger,
  ): Promise<AgentReviewResult[]> {
    // Belt-and-suspenders over the route's `z.string().min(1)`, which does
    // not catch a whitespace-only body.
    if (diff.trim().length === 0) {
      throw new AppError('empty_diff', 'Diff is empty', 400);
    }

    const repo = await this.repos.getById(workspaceId, repoId);
    if (!repo) throw new NotFoundError('Repo not found');

    const agents = await this.container.agentsRepo.listEnabled(workspaceId);
    if (agents.length === 0) {
      throw new AppError('no_enabled_agents', 'Repo has no enabled agents', 400);
    }

    const parsed = parseUnifiedDiff(diff);
    if (parsed.files.length === 0) {
      throw new AppError(
        'unparseable_diff',
        'Diff contained no recognizable file changes',
        400,
      );
    }

    const results: AgentReviewResult[] = [];
    for (const agent of agents) {
      try {
        const outcome = await runAgentReview(this.container, {
          repoId,
          diff: parsed,
          agent,
          taskPrefix: workingTreeTaskLine(),
          sessionId: `${repo.owner}/${repo.name}:working:${agent.name}`,
        });
        results.push({
          agent: { id: agent.id, name: agent.name },
          verdict: outcome.review.verdict,
          score: outcome.review.score,
          blockers: countBlockers(outcome.review.findings, agent.ciFailOn),
          findings: outcome.review.findings,
        });
      } catch (err) {
        logger?.error(
          { agent: agent.name, err: (err as Error).message },
          `review-diff: agent "${agent.name}" failed`,
        );
      }
    }

    if (results.length === 0) {
      throw new AppError('review_failed', 'All agents failed to produce a review', 502);
    }

    return results;
  }
}
