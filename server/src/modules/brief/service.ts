import type { Brief } from '@devdigest/shared';
import { Brief as BriefSchema } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { NotFoundError, ExternalServiceError } from '../../platform/errors.js';
import { ReviewRepository } from '../reviews/repository.js';
import { BlastService } from '../blast/service.js';
import { SmartDiffService } from '../smart-diff/service.js';
import { ContextService } from '../context/service.js';
import { resolveFeatureModel } from '../settings/feature-models.js';
import { BRIEF_FEATURE_ID, MAX_BRIEF_SPEC_DOCS, MAX_BRIEF_SPEC_CHARS, MAX_BRIEF_ISSUE_CHARS } from './constants.js';
import {
  buildBriefInput,
  groundBrief,
  smartDiffCounts,
  changedPathsOf,
  capSpecCorpus,
  capText,
  type BriefFacts,
  type LinkedIssueInput,
} from './helpers.js';

/** Minimal structured logger (pino-compatible: (obj, msg)) — same shape used by `IntentService`/`BlastService`. */
export type Logger = {
  info: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
};

export interface BriefMetrics {
  model: string;
  provider: string;
  tokensIn: number;
  tokensOut: number;
  inputChars: number;
  estBriefTokens: number;
}

/**
 * PR Why + Risk Brief module. Mirrors `IntentService`'s constructor/DI shape:
 * news up its own `ReviewRepository` (+ the sibling `BlastService`/
 * `SmartDiffService`/`ContextService`) from `container`, none of them added
 * to the DI container (matches every sibling module — avoids container
 * churn). `get()` is a pure cache read that NEVER generates (AC-13);
 * `generate()` is the one write path, shared by Generate and Regenerate.
 */
export class BriefService {
  private repo: ReviewRepository;
  private blast: BlastService;
  private smartDiff: SmartDiffService;
  private context: ContextService;

  constructor(private container: Container) {
    this.repo = new ReviewRepository(container.db);
    this.blast = new BlastService(container);
    this.smartDiff = new SmartDiffService(container);
    this.context = new ContextService(container);
  }

  /** Read the cached brief for a PR (workspace-scoped). `null` when never generated — never generates (AC-13). */
  async get(workspaceId: string, prId: string): Promise<Brief | null> {
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    const brief = await this.repo.getBrief(prId);
    return brief ?? null;
  }

  /**
   * Generate (or regenerate) the brief and persist it, overwriting any prior
   * cached row (AC-11). Every fact-gathering step is best-effort/degrading —
   * a missing intent, empty blast radius, unreachable linked issue, or empty
   * spec set never fails the call (AC-3/AC-4) — except the hard PR-not-found
   * guard. Makes exactly ONE structured LLM call (AC-5); on a malformed
   * response, throws WITHOUT persisting, so any prior cached brief stays
   * untouched (AC-8).
   */
  async generate(workspaceId: string, prId: string, logger?: Logger): Promise<{ brief: Brief; metrics: BriefMetrics }> {
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    const repoRow = await this.repo.getRepo(pull.repoId);
    if (!repoRow) throw new NotFoundError('Repo not found');

    const intent = (await this.repo.getIntent(prId)) ?? null;

    const blastRadius = await this.blast.get(workspaceId, prId);
    const smartDiff = await this.smartDiff.get(workspaceId, prId);

    const files = await this.repo.getPrFiles(prId);
    const changedPaths = changedPathsOf(files);

    // Best-effort linked issue. Degrades silently offline / on the mock
    // adapter (hardcodes `linked_issue: null`) / when there is no linked
    // issue — a normal case, not an error (AC-3).
    let linkedIssue: LinkedIssueInput | undefined;
    try {
      const github = await this.container.github();
      const detail = await github.getPullRequest({ owner: repoRow.owner, name: repoRow.name }, pull.number);
      linkedIssue = detail.linked_issue
        ? {
            title: detail.linked_issue.title,
            body: detail.linked_issue.body ? capText(detail.linked_issue.body, MAX_BRIEF_ISSUE_CHARS) : null,
            state: detail.linked_issue.state,
          }
        : undefined;
    } catch {
      // offline / no GITHUB_TOKEN / no linked issue — degrade silently.
    }

    // Best-effort spec gathering: a capped slice of the repo's discovered
    // Context-Folder docs, char-capped across the corpus. Any doc that fails
    // to read is skipped; an empty set is fine (AC-4).
    let specs: { path: string; content: string }[] = [];
    try {
      const docs = await this.context.listForRepo(workspaceId, pull.repoId);
      const selected = docs.slice(0, MAX_BRIEF_SPEC_DOCS);
      const read: { path: string; content: string }[] = [];
      for (const doc of selected) {
        try {
          const file = await this.context.getFileContent(workspaceId, pull.repoId, doc.path);
          read.push({ path: file.path, content: file.content });
        } catch {
          // unreadable spec — skip, never fail the generation.
        }
      }
      specs = capSpecCorpus(read, MAX_BRIEF_SPEC_CHARS);
    } catch {
      specs = [];
    }

    // Workspace-level resolver only — per-repo override is a Non-goal for this feature.
    const { provider, model } = await resolveFeatureModel(this.container, workspaceId, BRIEF_FEATURE_ID);

    const facts: BriefFacts = {
      intent,
      blastSummary: blastRadius.summary,
      downstream: blastRadius.downstream,
      smartDiffCounts: smartDiffCounts(smartDiff),
      changedPaths,
      ...(linkedIssue ? { linkedIssue } : {}),
      specs,
    };

    const { messages, inputChars, estBriefTokens } = buildBriefInput(facts);

    const llm = await this.container.llm(provider as 'openai' | 'anthropic' | 'openrouter');

    // Exactly ONE structured call per generate() invocation (AC-5).
    const result = await llm.completeStructured({
      model,
      schema: BriefSchema,
      schemaName: 'pr_brief',
      temperature: 0.1,
      messages,
    });

    // Defense-in-depth over the provider's structured mode: never persist a
    // partial/garbage brief, and never touch the prior cached row (AC-8).
    const parsed = BriefSchema.safeParse(result.data);
    if (!parsed.success) {
      throw new ExternalServiceError(
        'Risk brief generator returned an invalid response shape',
        parsed.error.flatten(),
      );
    }

    const grounded = groundBrief(parsed.data, new Set(changedPaths));

    await this.repo.upsertBrief(prId, grounded);

    const metrics: BriefMetrics = {
      model,
      provider,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
      inputChars,
      estBriefTokens,
    };

    // Observability is this structured log line only — no `agent_run`/`run_trace`
    // is created (same decision as `IntentService`). Never returned to the card (AC-14).
    logger?.info({ prId, ...metrics }, `brief: generated for PR ${prId}`);

    return { brief: grounded, metrics };
  }
}
