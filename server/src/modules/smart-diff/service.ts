import type { SmartDiff } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { NotFoundError } from '../../platform/errors.js';
import { ReviewRepository } from '../reviews/repository.js';
import { buildSmartDiff } from './helpers.js';

/**
 * Smart Diff composer. Mirrors `IntentService`'s DI pattern: news up
 * `ReviewRepository` from `container.db` — no new repository, no LLM call.
 * Deterministically composes two already-persisted things (`pr_files` +
 * the most recent completed review's findings) into the pre-existing
 * `SmartDiff` contract.
 */
export class SmartDiffService {
  private repo: ReviewRepository;

  constructor(container: Container) {
    this.repo = new ReviewRepository(container.db);
  }

  /**
   * Build the Smart Diff grouping for a PR (workspace-scoped). The findings
   * overlay comes from the single newest `kind === 'review'` row in
   * `reviewsForPull` (same "newest-first, take first" precedent as the
   * PR-list's `latestReviewByPr` in `modules/pulls/routes.ts`) — a PR with no
   * completed review yields all-empty `finding_lines`, not an error.
   */
  async get(workspaceId: string, prId: string): Promise<SmartDiff> {
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');

    const files = await this.repo.getPrFiles(prId);
    const reviews = await this.repo.reviewsForPull(prId);
    const latest = reviews.find((r) => r.review.kind === 'review');
    const findings = latest ? latest.findings : [];

    return buildSmartDiff(
      files.map((f) => ({ path: f.path, additions: f.additions, deletions: f.deletions })),
      findings.map((f) => ({ file: f.file, start_line: f.startLine })),
    );
  }
}
