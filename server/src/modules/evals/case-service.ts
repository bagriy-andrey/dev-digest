import type { Container } from '../../platform/container.js';
import type { EvalCase, EvalCaseInput, EvalOwnerKind } from '@devdigest/shared';
import { AppError, ConflictError, NotFoundError, ValidationError } from '../../platform/errors.js';
import { EvalsRepository } from './repository.js';
import { parseExpectations, ExpectationValidationError } from './expectations.js';
import { loadDiff } from '../reviews/diff-loader.js';

/**
 * Application layer over the eval repository (SPEC-03 step 4). Owns:
 *  - CRUD for hand-authored/edited eval cases, `owner_kind`/`owner_id` always
 *    DERIVED from the route path (never trusted from the request body —
 *    spec API table).
 *  - `createFromFinding` (AC-2..7): turning a decided finding into a case.
 *
 * Deliberately does NOT run anything through the review engine — that is
 * `runner.ts`'s job.
 */
export class EvalCaseService {
  private repo: EvalsRepository;

  constructor(private container: Container) {
    this.repo = new EvalsRepository(container.db);
  }

  async list(workspaceId: string, ownerKind: EvalOwnerKind, ownerId: string): Promise<EvalCase[]> {
    return this.repo.listByOwner(workspaceId, ownerKind, ownerId);
  }

  async get(workspaceId: string, id: string): Promise<EvalCase | undefined> {
    return this.repo.getCase(workspaceId, id);
  }

  /**
   * `owner_kind`/`owner_id` come from the caller (resolved by the route from
   * the path, e.g. `/agents/:id/eval-cases`) — never from `input.owner_kind`/
   * `input.owner_id`, even though the wire contract carries those fields.
   */
  async create(
    workspaceId: string,
    ownerKind: EvalOwnerKind,
    ownerId: string,
    input: EvalCaseInput,
  ): Promise<EvalCase> {
    const expectations = this.parseOrThrow(input.expected_output);
    return this.repo.insertCase({
      workspaceId,
      ownerKind,
      ownerId,
      name: input.name,
      inputDiff: input.input_diff,
      inputFiles: input.input_files,
      inputMeta: input.input_meta,
      expectedOutput: expectations,
      notes: input.notes,
    });
  }

  /** Owner is NEVER touched by an update — only the id-addressed row's own fields. */
  async update(workspaceId: string, id: string, input: EvalCaseInput): Promise<EvalCase | undefined> {
    const expectations = this.parseOrThrow(input.expected_output);
    return this.repo.updateCase(workspaceId, id, {
      name: input.name,
      inputDiff: input.input_diff,
      inputFiles: input.input_files,
      inputMeta: input.input_meta,
      expectedOutput: expectations,
      notes: input.notes,
    });
  }

  async delete(workspaceId: string, id: string): Promise<boolean> {
    return this.repo.deleteCase(workspaceId, id);
  }

  /**
   * AC-8 — `expected_output` must validate BEFORE anything is written; on
   * failure, a 400 (NOT the generic `ValidationError`'s 422) naming the first
   * invalid entry.
   */
  private parseOrThrow(raw: unknown) {
    try {
      return parseExpectations(raw);
    } catch (err) {
      if (err instanceof ExpectationValidationError) {
        throw new AppError('validation_error', err.message, 400);
      }
      throw err;
    }
  }

  /**
   * Turn a decided finding into an eval case (AC-2..7), idempotent (AC-6).
   * Returns `created: false` when an existing case for this finding id is
   * returned instead of a new one (route maps that to 200, a new case to 201).
   */
  async createFromFinding(
    workspaceId: string,
    findingId: string,
  ): Promise<{ evalCase: EvalCase; created: boolean }> {
    const ctx = await this.container.reviewRepo.findingContext(findingId);
    if (!ctx) throw new NotFoundError('Finding not found');
    const { finding, review, pull } = ctx;

    if (!finding.acceptedAt && !finding.dismissedAt) {
      throw new ValidationError(
        'Finding has not been accepted or dismissed yet — decide it before turning it into an eval case',
      );
    }

    if (!review.agentId) {
      throw new ConflictError(
        'This finding\'s review has no owning agent (it may have been deleted) — cannot create an eval case',
      );
    }
    const agentId = review.agentId;

    const existing = await this.repo.findByFindingId(workspaceId, agentId, findingId);
    if (existing) return { evalCase: existing, created: false };

    const repoRow = await this.container.reviewRepo.getRepo(pull.repoId);
    if (!repoRow) throw new NotFoundError('Repo not found');

    const diff = await loadDiff(this.container, this.container.reviewRepo, workspaceId, pull, repoRow);

    const decision: 'accepted' | 'dismissed' = finding.acceptedAt ? 'accepted' : 'dismissed';

    const evalCase = await this.repo.insertCase({
      workspaceId,
      ownerKind: 'agent',
      ownerId: agentId,
      name: finding.title,
      inputDiff: diff.raw,
      inputFiles: diff.files.map((f) => ({ path: f.path, additions: f.additions, deletions: f.deletions })),
      inputMeta: {
        finding_id: finding.id,
        pr_id: pull.id,
        repo_id: pull.repoId,
        pr_number: pull.number,
        pr_title: pull.title,
        pr_body: pull.body,
        decision,
        captured_at: new Date().toISOString(),
      },
      // Kind is a SNAPSHOT of the decision at capture time — never recomputed
      // later even if the user reverses accept/dismiss (AC-25).
      expectedOutput: [
        {
          kind: decision === 'accepted' ? 'must_find' : 'must_not_flag',
          file: finding.file,
          start_line: finding.startLine,
          end_line: finding.endLine,
          severity: finding.severity,
          category: finding.category,
          title: finding.title,
        },
      ],
      notes: null,
    });

    return { evalCase, created: true };
  }
}
