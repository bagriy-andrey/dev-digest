import { z } from 'zod';
import type { BlastRadius } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { NotFoundError, ExternalServiceError } from '../../platform/errors.js';
import { ReviewRepository } from '../reviews/repository.js';
import { resolveFeatureModelForRepo } from '../settings/feature-models.js';
import { toBlastRadius, EMPTY_BLAST_RADIUS } from './helpers.js';

export interface BlastRadiusResult extends BlastRadius {
  degraded?: boolean;
  degraded_reason?: string | null;
}

/** OPTIONAL step — the only place any model is invoked in this feature. */
const BLAST_SUMMARY_FEATURE_ID = 'blast_summary' as const;

const SummarySchema = z.object({ summary: z.string() });

/** Minimal structured logger (pino-compatible), same shape as `IntentService`'s. */
export type Logger = {
  info: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
};

/**
 * Blast Radius module. Composes `repoIntel.getBlastRadius()` — already fully
 * computed (symbols, resolved call references, file rank, endpoint/cron
 * facts read straight from Postgres) — into the `BlastRadius` contract.
 *
 * Mirrors `IntentService`'s constructor/DI shape (news up `ReviewRepository`
 * from `container.db`, no new repository), but `get()` makes ZERO LLM calls
 * — it is pure composition over an already-persisted index, recomputed on
 * every request (cheap: pure reads, no clone parsing).
 */
export class BlastService {
  private repo: ReviewRepository;

  constructor(private container: Container) {
    this.repo = new ReviewRepository(container.db);
  }

  /** Other PRs in the same repo touching any of `paths`, excluding `prId`. Shared by
   *  `get()`/`summarize()` so both always carry the same prior-PRs data (no drift). */
  private async priorPrsFor(repoId: string, prId: string, paths: string[]) {
    return this.repo.getPrsTouchingFiles(repoId, prId, paths);
  }

  /** path -> raw GitHub patch text, for files the persisted repo-intel index has no data for
   *  (server/specs/blast-radius-pr-branch-symbols.md). Files with no `patch` (GitHub omits it
   *  for very large/binary diffs) are simply absent from the map — repo-intel degrades cleanly
   *  for those, same as today. Shared by `get()`/`summarize()` for the same reason as
   *  `priorPrsFor` above. */
  private patchesByFile(files: { path: string; patch: string | null }[]): Record<string, string> {
    return Object.fromEntries(files.filter((f) => f.patch).map((f) => [f.path, f.patch!]));
  }

  /**
   * Compute the blast radius for a PR (workspace-scoped). Never persists
   * anything — every call recomputes from the live index.
   */
  async get(workspaceId: string, prId: string): Promise<BlastRadiusResult> {
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');

    // No changed files at all → genuinely nothing to show, not an index
    // problem. No `degraded` flag: this is a "nothing changed here" case.
    const files = await this.repo.getPrFiles(prId);
    if (files.length === 0) return EMPTY_BLAST_RADIUS;

    const result = await this.container.repoIntel.getBlastRadius(
      pull.repoId,
      files.map((f) => f.path),
      this.patchesByFile(files),
    );
    const prior_prs = await this.priorPrsFor(
      pull.repoId,
      prId,
      files.map((f) => f.path),
    );
    const radius = { ...toBlastRadius(result), prior_prs };

    if (result.degraded == null) return radius;
    return { ...radius, degraded: result.degraded, degraded_reason: result.reason ?? null };
  }

  /**
   * OPTIONAL, separable, manually-triggered: one cheap-model call that
   * summarizes the already-computed blast map in one short paragraph. NEVER
   * called by `get()` — mirrors `IntentService.recalculate`'s "never runs
   * automatically" rule. Persists nothing; every call re-summarizes from the
   * live index (the map itself is the only input — no raw code is sent).
   */
  async summarize(workspaceId: string, prId: string, logger?: Logger): Promise<BlastRadiusResult> {
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');

    const files = await this.repo.getPrFiles(prId);
    if (files.length === 0) return EMPTY_BLAST_RADIUS;

    const result = await this.container.repoIntel.getBlastRadius(
      pull.repoId,
      files.map((f) => f.path),
      this.patchesByFile(files),
    );
    const prior_prs = await this.priorPrsFor(
      pull.repoId,
      prId,
      files.map((f) => f.path),
    );
    const radius = { ...toBlastRadius(result), prior_prs };
    const degradedFields =
      result.degraded == null
        ? {}
        : { degraded: result.degraded, degraded_reason: result.reason ?? null };

    // Nothing to summarize — skip the model call entirely (matches `get()`'s
    // "genuinely nothing here" behavior).
    if (radius.changed_symbols.length === 0) {
      return { ...radius, ...degradedFields };
    }

    const { provider, model } = await resolveFeatureModelForRepo(
      this.container,
      workspaceId,
      pull.repoId,
      BLAST_SUMMARY_FEATURE_ID,
    );

    const llm = await this.container.llm(provider as 'openai' | 'anthropic' | 'openrouter');
    const outcome = await llm.completeStructured({
      model,
      schema: SummarySchema,
      schemaName: 'blast_summary',
      temperature: 0.2,
      messages: [
        {
          role: 'system',
          content:
            "You summarize a pull request's blast radius map in ONE short paragraph " +
            '(2-4 sentences), plain prose, no markdown. Explain what could break, in ' +
            'terms a reviewer can act on.',
        },
        { role: 'user', content: JSON.stringify(radius.downstream) },
      ],
    });

    // Defense-in-depth over the provider's structured mode.
    const parsed = SummarySchema.safeParse(outcome.data);
    if (!parsed.success) {
      throw new ExternalServiceError(
        'Blast summary returned an invalid response shape',
        parsed.error.flatten(),
      );
    }

    logger?.info({ prId, model }, `blast: summarized for PR ${prId}`);

    return { ...radius, ...degradedFields, summary: parsed.data.summary };
  }
}
