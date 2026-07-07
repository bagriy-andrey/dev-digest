import type { FeatureModelChoice, Intent, RepoFeatureModel } from '@devdigest/shared';
import { Intent as IntentSchema } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { NotFoundError, ExternalServiceError } from '../../platform/errors.js';
import { ReviewRepository } from '../reviews/repository.js';
import { RepoRepository } from '../repos/repository.js';
import {
  resolveFeatureModelForRepo,
  getRepoFeatureModel,
  setRepoFeatureModel,
} from '../settings/feature-models.js';
import { buildClassifierInput, type TokenMetrics, type LinkedIssueInput } from './helpers.js';

const INTENT_FEATURE_ID = 'review_intent' as const;

/** Minimal structured logger (pino-compatible: (obj, msg)) — same shape used
 *  elsewhere for request-scoped logging (e.g. `reviews/run-executor.ts`). */
export type Logger = {
  info: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
};

/**
 * Intent classifier module. Mirrors `ConventionsService`'s constructor/DI
 * pattern: news up its own repository from `container.db`, resolves its LLM
 * provider via the settings feature-model resolver, and calls
 * `llm.completeStructured` with the shared `Intent` contract as the schema.
 *
 * The classifier NEVER runs automatically — only via `recalculate`, invoked
 * from the manual "Recalculate" route/button. No `agent_run`/`run_trace` is
 * created for this call; observability is the structured metrics log line
 * plus the returned `{ intent, metrics }` (spec decision — see
 * `server/specs/intent-layer.md` §1.3).
 */
export class IntentService {
  private repo: ReviewRepository;
  private repos: RepoRepository;

  constructor(private container: Container) {
    this.repo = new ReviewRepository(container.db);
    this.repos = new RepoRepository(container.db);
  }

  /** Read the stored intent for a PR (workspace-scoped). `null` when never classified. */
  async get(workspaceId: string, prId: string): Promise<Intent | null> {
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    const intent = await this.repo.getIntent(prId);
    return intent ?? null;
  }

  /**
   * Classify (or re-classify) a PR's intent/scope and persist it. Best-effort
   * linked-issue resolution degrades silently (offline / mock adapter / no
   * linked issue) — never an error. Throws on a malformed classifier response
   * instead of persisting a partial/garbage intent.
   */
  async recalculate(
    workspaceId: string,
    prId: string,
    logger?: Logger,
  ): Promise<{ intent: Intent; metrics: TokenMetrics }> {
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    const repoRow = await this.repo.getRepo(pull.repoId);
    if (!repoRow) throw new NotFoundError('Repo not found');
    const files = await this.repo.getPrFiles(prId);

    // Best-effort linked issue + fresh body. Degrades silently offline / on
    // the mock adapter (which hardcodes `linked_issue: null`) / when the repo
    // has no linked issue — this is a normal case, not an error.
    let linkedIssue: LinkedIssueInput | undefined;
    let body = pull.body;
    try {
      const github = await this.container.github();
      const detail = await github.getPullRequest(
        { owner: repoRow.owner, name: repoRow.name },
        pull.number,
      );
      linkedIssue = detail.linked_issue
        ? {
            title: detail.linked_issue.title,
            body: detail.linked_issue.body ?? null,
            state: detail.linked_issue.state,
          }
        : undefined;
      body = detail.body ?? pull.body;
    } catch {
      // offline / no GITHUB_TOKEN / no linked issue — degrade silently.
    }

    const { provider, model } = await resolveFeatureModelForRepo(
      this.container,
      workspaceId,
      pull.repoId,
      INTENT_FEATURE_ID,
    );

    const { messages, metrics } = buildClassifierInput({
      title: pull.title,
      body,
      ...(linkedIssue ? { linkedIssue } : {}),
      files: files.map((f) => ({ path: f.path, patch: f.patch })),
    });

    const llm = await this.container.llm(provider as 'openai' | 'anthropic' | 'openrouter');

    const result = await llm.completeStructured({
      model,
      schema: IntentSchema,
      schemaName: 'pr_intent',
      temperature: 0.1,
      messages,
    });

    // Defense-in-depth over the provider's structured mode: never persist a
    // partial/garbage intent.
    const parsed = IntentSchema.safeParse(result.data);
    if (!parsed.success) {
      throw new ExternalServiceError(
        'Intent classifier returned an invalid response shape',
        parsed.error.flatten(),
      );
    }
    const intent = parsed.data;

    await this.repo.upsertIntent(prId, intent);

    logger?.info(
      {
        prId,
        fullDiffChars: metrics.fullDiffChars,
        hunkOnlyChars: metrics.hunkOnlyChars,
        savedChars: metrics.savedChars,
        savedPct: metrics.savedPct,
        estFullTokens: metrics.estFullTokens,
        estHunkTokens: metrics.estHunkTokens,
      },
      `intent: recalculated for PR ${prId} — hunk-header projection saved ${metrics.savedPct}% of diff chars`,
    );

    return { intent, metrics };
  }

  /**
   * Read the repo-level classifier model override, or `null` when unset.
   * Verifies the repo belongs to the caller's workspace first (A01).
   */
  async getRepoModel(workspaceId: string, repoId: string): Promise<RepoFeatureModel | null> {
    const repoRow = await this.repos.getById(workspaceId, repoId);
    if (!repoRow) throw new NotFoundError('Repo not found');
    const choice = await getRepoFeatureModel(this.container, repoId, INTENT_FEATURE_ID);
    return choice ? { feature: INTENT_FEATURE_ID, ...choice } : null;
  }

  /**
   * Upsert the repo-level classifier model override. The feature id is
   * ALWAYS hardcoded to `'review_intent'` here — never taken from the
   * caller — so this endpoint can't write arbitrary feature rows. Verifies
   * the repo belongs to the caller's workspace first (A01).
   */
  async setRepoModel(
    workspaceId: string,
    repoId: string,
    choice: FeatureModelChoice,
  ): Promise<RepoFeatureModel> {
    const repoRow = await this.repos.getById(workspaceId, repoId);
    if (!repoRow) throw new NotFoundError('Repo not found');
    await setRepoFeatureModel(this.container, repoId, INTENT_FEATURE_ID, choice);
    return { feature: INTENT_FEATURE_ID, ...choice };
  }
}
