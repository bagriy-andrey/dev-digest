import { randomUUID } from 'node:crypto';
import type { Container } from '../../platform/container.js';
import type { AgentRow } from '../../db/rows.js';
import type { EvalBatchStart, EvalBatchStartAll, EvalCase, EvalRunDetail, EvalRunRecord } from '@devdigest/shared';
import { NotFoundError, ConflictError } from '../../platform/errors.js';
import { parseUnifiedDiff } from '../../adapters/git/diff-parser.js';
import { runAgentReview } from '../reviews/agent-runner.js';
import { EvalsRepository } from './repository.js';
import { parseExpectations } from './expectations.js';
import { scoreCase } from './scorer.js';
import { EVAL_CASE_TIMEOUT_MS, EVAL_TASK_PREFIX, MAX_RECENT_RUNS, evalSessionId } from './constants.js';
import * as batchRegistry from './batch-registry.js';

/**
 * The execution path (SPEC-03 step 4). An eval run is a CONSUMER of the
 * existing agent-run path (`runAgentReview` — the single resolution
 * mechanism), never a second implementation of it. Must NOT insert
 * `reviews`/`findings`/`agent_runs` rows and must NOT publish on `runBus`
 * (spec §"Internal contract: eval run ↔ review engine") — an eval run is not
 * a PR review.
 */

const ZERO_COUNTS = { must_find: 0, matched: 0, actual: 0, noise: 0, dropped: 0 };

function timeout(ms: number): Promise<never> {
  return new Promise((_, reject) => {
    const t = setTimeout(() => reject(new Error(`Eval case run timed out after ${ms}ms`)), ms);
    // Never keep the process alive just for this guard — the moment the real
    // `runAgentReview` call settles, `Promise.race` moves on and this timer
    // becomes irrelevant (matters for hermetic tests using the real 2-minute
    // constant against an instant mock provider).
    t.unref?.();
  });
}

export class EvalRunner {
  private repo: EvalsRepository;

  constructor(private container: Container) {
    this.repo = new EvalsRepository(container.db);
  }

  /**
   * Trigger a batch for one agent. Returns immediately (AC-12) — the actual
   * cases execute in the background via a fire-and-forget `executeBatch`.
   */
  async startBatch(workspaceId: string, agentId: string): Promise<EvalBatchStart> {
    const agent = await this.container.agentsRepo.getById(workspaceId, agentId);
    if (!agent) throw new NotFoundError('Agent not found');

    // AC-21 — zero cases: succeed with a null batch, create nothing.
    const casesTotal = await this.repo.countByOwner(workspaceId, 'agent', agentId);
    if (casesTotal === 0) return { batch_id: null, cases_total: 0 };

    const batchId = randomUUID();
    // AC-23 — a second concurrent batch for the same agent is rejected, not queued.
    if (!batchRegistry.tryAcquire(agentId, batchId)) {
      throw new ConflictError(`An eval batch is already running for agent ${agentId}`);
    }

    // Fire-and-forget (mirrors ReviewService.runReview) — the HTTP response
    // returns now with the batch id; rows are persisted as each case completes.
    // `executeBatch` itself catches every per-case failure (AC-20) and always
    // releases the registry slot in its own `finally`; this `.catch` is only a
    // last-resort net against an unexpected error BEFORE the per-case loop
    // (e.g. `listByOwner` itself failing) so it never surfaces as an
    // unhandled rejection.
    void this.executeBatch(workspaceId, agent, batchId).catch(() => {});

    return { batch_id: batchId, cases_total: casesTotal };
  }

  /** Enabled agents only; swallows an individual agent's "already running" 409. */
  async startAllAgents(workspaceId: string): Promise<EvalBatchStartAll> {
    const agents = await this.container.agentsRepo.listEnabled(workspaceId);
    const batches: EvalBatchStartAll['batches'] = [];
    for (const agent of agents) {
      try {
        const { batch_id, cases_total } = await this.startBatch(workspaceId, agent.id);
        batches.push({ agent_id: agent.id, batch_id, cases_total });
      } catch (err) {
        if (err instanceof ConflictError) {
          batches.push({ agent_id: agent.id, batch_id: null, cases_total: 0 });
          continue;
        }
        throw err;
      }
    }
    return { batches };
  }

  /** Run rows for an agent (optionally filtered to one batch), newest first. */
  async listRuns(workspaceId: string, agentId: string, batchId?: string): Promise<EvalRunRecord[]> {
    return this.repo.runsForOwner(workspaceId, agentId, {
      ...(batchId !== undefined ? { batchId } : {}),
      limit: MAX_RECENT_RUNS,
    });
  }

  /** A one-case batch (`cases_total: 1`), same execution path as `executeBatch`. */
  async runSingleCase(workspaceId: string, caseId: string): Promise<EvalBatchStart> {
    const caseRow = await this.repo.getCase(workspaceId, caseId);
    if (!caseRow) throw new NotFoundError('Eval case not found');
    const agent = await this.container.agentsRepo.getById(workspaceId, caseRow.owner_id);
    if (!agent) throw new NotFoundError('Agent not found');

    const batchId = randomUUID();
    if (!batchRegistry.tryAcquire(agent.id, batchId)) {
      throw new ConflictError(`An eval batch is already running for agent ${agent.id}`);
    }
    const agentVersion = agent.version;
    void (async () => {
      try {
        await this.runCase(agent, caseRow, batchId, agentVersion);
      } finally {
        batchRegistry.release(agent.id);
      }
    })();

    return { batch_id: batchId, cases_total: 1 };
  }

  /** Runs every case for `agent` sequentially (no fan-out — Performance NFR). */
  private async executeBatch(workspaceId: string, agent: AgentRow, batchId: string): Promise<void> {
    // AC-22 — capture the version ONCE before the loop; every row in this
    // batch gets the SAME version, not re-read per case.
    const agentVersion = agent.version;
    try {
      const cases = await this.repo.listByOwner(workspaceId, 'agent', agent.id);
      for (const caseRow of cases) {
        await this.runCase(agent, caseRow, batchId, agentVersion);
      }
    } finally {
      batchRegistry.release(agent.id);
    }
  }

  /**
   * Run one case through the real review engine and persist its row.
   * Catches EVERYTHING (parse failure, provider-resolution failure,
   * structured-output parse failure, timeout) → a failure row; never
   * propagates, so the batch loop always continues (AC-20).
   */
  private async runCase(
    agent: AgentRow,
    caseRow: EvalCase,
    batchId: string,
    agentVersion: number,
  ): Promise<void> {
    const startedAt = Date.now();
    try {
      const diff = parseUnifiedDiff(caseRow.input_diff);
      if (diff.files.length === 0) {
        await this.persistFailure(
          caseRow.id,
          batchId,
          agentVersion,
          'Stored diff does not parse, or parses to zero files',
          Date.now() - startedAt,
        );
        return;
      }

      const meta = (caseRow.input_meta ?? {}) as Record<string, unknown>;
      const repoId = typeof meta.repo_id === 'string' ? meta.repo_id : '';
      const prBody = typeof meta.pr_body === 'string' ? meta.pr_body : undefined;

      // D6 — `taskPrefix` stays the fixed, trusted module constant, ALWAYS.
      // Any recorded PR title/body flows through `prDescription` only (which
      // `assemblePrompt` delimiter-wraps as untrusted) — never concatenated
      // into `taskPrefix` or any other trusted-framing string.
      const outcome = await Promise.race([
        runAgentReview(this.container, {
          repoId,
          diff,
          agent,
          taskPrefix: EVAL_TASK_PREFIX,
          sessionId: evalSessionId(caseRow.id),
          ...(prBody ? { prDescription: prBody } : {}),
        }),
        timeout(EVAL_CASE_TIMEOUT_MS),
      ]);

      const expectations = parseExpectations(caseRow.expected_output);
      const scored = scoreCase(expectations, outcome.review.findings, outcome.dropped.length);

      const detail: EvalRunDetail = {
        findings: outcome.review.findings,
        counts: scored.counts,
        model: agent.model,
        error: null,
      };

      await this.repo.insertRun({
        caseId: caseRow.id,
        batchId,
        agentVersion,
        actualOutput: detail,
        pass: scored.pass,
        recall: scored.recall,
        precision: scored.precision,
        citationAccuracy: scored.citation_accuracy,
        durationMs: Date.now() - startedAt,
        costUsd: outcome.costUsd,
      });
    } catch (err) {
      await this.persistFailure(
        caseRow.id,
        batchId,
        agentVersion,
        (err as Error).message || 'Eval case run failed',
        Date.now() - startedAt,
      );
    }
  }

  private async persistFailure(
    caseId: string,
    batchId: string,
    agentVersion: number,
    message: string,
    durationMs: number,
  ): Promise<void> {
    const detail: EvalRunDetail = {
      findings: [],
      counts: { ...ZERO_COUNTS },
      model: null,
      error: message,
    };
    await this.repo.insertRun({
      caseId,
      batchId,
      agentVersion,
      actualOutput: detail,
      pass: false,
      recall: null,
      precision: null,
      citationAccuracy: null,
      durationMs,
      costUsd: null,
    });
  }
}
