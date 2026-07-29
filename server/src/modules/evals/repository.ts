import { and, desc, eq, count, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { EvalCase, EvalOwnerKind, EvalRunRecord } from '@devdigest/shared';
import { toEvalCase, toEvalRunRecord } from './helpers.js';
export type { EvalCaseRow, EvalRunRow } from './helpers.js';

/**
 * EvalsRepository — pure data-access over `container.db` for `eval_cases`/
 * `eval_runs`. Queries only, NO business logic (no scoring, no HTTP status
 * codes, no "is this allowed" checks — that's step 4's `case-service.ts`/
 * `runner.ts`).
 *
 * `eval_runs` has NO workspace column, so every run-related query joins
 * through `eval_cases` to enforce workspace scoping.
 */

export interface InsertEvalCase {
  workspaceId: string;
  ownerKind: EvalOwnerKind;
  ownerId: string;
  name: string;
  inputDiff?: string | null;
  inputFiles?: unknown;
  inputMeta?: unknown;
  expectedOutput?: unknown;
  notes?: string | null;
}

export interface UpdateEvalCase {
  name?: string;
  inputDiff?: string | null;
  inputFiles?: unknown;
  inputMeta?: unknown;
  expectedOutput?: unknown;
  notes?: string | null;
}

export interface InsertEvalRun {
  caseId: string;
  batchId?: string | null;
  agentVersion?: number | null;
  actualOutput?: unknown;
  pass?: boolean | null;
  recall?: number | null;
  precision?: number | null;
  citationAccuracy?: number | null;
  durationMs?: number | null;
  costUsd?: number | null;
}

export interface OwnerCaseCount {
  ownerKind: EvalOwnerKind;
  ownerId: string;
  count: number;
}

export class EvalsRepository {
  constructor(private db: Db) {}

  // ---- eval_cases ----------------------------------------------------------

  async listByOwner(
    workspaceId: string,
    ownerKind: EvalOwnerKind,
    ownerId: string,
  ): Promise<EvalCase[]> {
    const rows = await this.db
      .select()
      .from(t.evalCases)
      .where(
        and(
          eq(t.evalCases.workspaceId, workspaceId),
          eq(t.evalCases.ownerKind, ownerKind),
          eq(t.evalCases.ownerId, ownerId),
        ),
      );
    return rows.map(toEvalCase);
  }

  async getCase(workspaceId: string, id: string): Promise<EvalCase | undefined> {
    const [row] = await this.db
      .select()
      .from(t.evalCases)
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.id, id)));
    return row ? toEvalCase(row) : undefined;
  }

  async insertCase(values: InsertEvalCase): Promise<EvalCase> {
    const [row] = await this.db
      .insert(t.evalCases)
      .values({
        workspaceId: values.workspaceId,
        ownerKind: values.ownerKind,
        ownerId: values.ownerId,
        name: values.name,
        inputDiff: values.inputDiff ?? null,
        inputFiles: (values.inputFiles as object | undefined) ?? null,
        inputMeta: (values.inputMeta as object | undefined) ?? null,
        expectedOutput: (values.expectedOutput as object | undefined) ?? null,
        notes: values.notes ?? null,
      })
      .returning();
    return toEvalCase(row!);
  }

  async updateCase(
    workspaceId: string,
    id: string,
    values: UpdateEvalCase,
  ): Promise<EvalCase | undefined> {
    const [row] = await this.db
      .update(t.evalCases)
      .set({
        ...(values.name !== undefined ? { name: values.name } : {}),
        ...(values.inputDiff !== undefined ? { inputDiff: values.inputDiff } : {}),
        ...(values.inputFiles !== undefined
          ? { inputFiles: values.inputFiles as object }
          : {}),
        ...(values.inputMeta !== undefined ? { inputMeta: values.inputMeta as object } : {}),
        ...(values.expectedOutput !== undefined
          ? { expectedOutput: values.expectedOutput as object }
          : {}),
        ...(values.notes !== undefined ? { notes: values.notes } : {}),
      })
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.id, id)))
      .returning();
    return row ? toEvalCase(row) : undefined;
  }

  /** Delete a case (workspace-scoped). `eval_runs` cascade via the FK. */
  async deleteCase(workspaceId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(t.evalCases)
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.id, id)))
      .returning({ id: t.evalCases.id });
    return rows.length > 0;
  }

  async countByOwner(
    workspaceId: string,
    ownerKind: EvalOwnerKind,
    ownerId: string,
  ): Promise<number> {
    const [row] = await this.db
      .select({ value: count() })
      .from(t.evalCases)
      .where(
        and(
          eq(t.evalCases.workspaceId, workspaceId),
          eq(t.evalCases.ownerKind, ownerKind),
          eq(t.evalCases.ownerId, ownerId),
        ),
      );
    return row?.value ?? 0;
  }

  /** Matches a case whose `input_meta.finding_id` equals `findingId` (AC-6, idempotent create-from-finding). */
  async findByFindingId(
    workspaceId: string,
    ownerId: string,
    findingId: string,
  ): Promise<EvalCase | undefined> {
    const [row] = await this.db
      .select()
      .from(t.evalCases)
      .where(
        and(
          eq(t.evalCases.workspaceId, workspaceId),
          eq(t.evalCases.ownerId, ownerId),
          sql`${t.evalCases.inputMeta} ->> 'finding_id' = ${findingId}`,
        ),
      );
    return row ? toEvalCase(row) : undefined;
  }

  // ---- eval_runs (no workspace column — always join through eval_cases) ----

  async insertRun(values: InsertEvalRun): Promise<EvalRunRecord> {
    const [row] = await this.db
      .insert(t.evalRuns)
      .values({
        caseId: values.caseId,
        batchId: values.batchId ?? null,
        agentVersion: values.agentVersion ?? null,
        actualOutput: (values.actualOutput as object | undefined) ?? null,
        pass: values.pass ?? null,
        recall: values.recall ?? null,
        precision: values.precision ?? null,
        citationAccuracy: values.citationAccuracy ?? null,
        durationMs: values.durationMs ?? null,
        costUsd: values.costUsd ?? null,
      })
      .returning();
    return toEvalRunRecord(row!);
  }

  /** All runs for one batch (newest first), case name attached. */
  async runsForBatch(batchId: string): Promise<EvalRunRecord[]> {
    const rows = await this.db
      .select({ run: t.evalRuns, caseName: t.evalCases.name })
      .from(t.evalRuns)
      .innerJoin(t.evalCases, eq(t.evalRuns.caseId, t.evalCases.id))
      .where(eq(t.evalRuns.batchId, batchId))
      .orderBy(desc(t.evalRuns.ranAt));
    return rows.map(({ run, caseName }) => toEvalRunRecord(run, caseName));
  }

  /** Runs belonging to one owner (agent/skill), workspace-scoped, newest first. */
  async runsForOwner(
    workspaceId: string,
    ownerId: string,
    opts: { batchId?: string; limit?: number } = {},
  ): Promise<EvalRunRecord[]> {
    const conditions = [
      eq(t.evalCases.workspaceId, workspaceId),
      eq(t.evalCases.ownerId, ownerId),
    ];
    if (opts.batchId !== undefined) conditions.push(eq(t.evalRuns.batchId, opts.batchId));

    const query = this.db
      .select({ run: t.evalRuns, caseName: t.evalCases.name })
      .from(t.evalRuns)
      .innerJoin(t.evalCases, eq(t.evalRuns.caseId, t.evalCases.id))
      .where(and(...conditions))
      .orderBy(desc(t.evalRuns.ranAt));
    const rows = opts.limit !== undefined ? await query.limit(opts.limit) : await query;
    return rows.map(({ run, caseName }) => toEvalRunRecord(run, caseName));
  }

  /** Distinct batch ids for an owner, most-recently-run batch first, capped at `limit`. */
  async batchesForOwner(workspaceId: string, ownerId: string, limit: number): Promise<string[]> {
    const rows = await this.db
      .select({ batchId: t.evalRuns.batchId })
      .from(t.evalRuns)
      .innerJoin(t.evalCases, eq(t.evalRuns.caseId, t.evalCases.id))
      .where(
        and(
          eq(t.evalCases.workspaceId, workspaceId),
          eq(t.evalCases.ownerId, ownerId),
          sql`${t.evalRuns.batchId} is not null`,
        ),
      )
      .groupBy(t.evalRuns.batchId)
      .orderBy(desc(sql`max(${t.evalRuns.ranAt})`))
      .limit(limit);
    return rows.map((r) => r.batchId as string);
  }

  /** Flat, cross-agent newest-first run list for the whole workspace (workspace dashboard). */
  async recentRunsForWorkspace(workspaceId: string, limit: number): Promise<EvalRunRecord[]> {
    const rows = await this.db
      .select({ run: t.evalRuns, caseName: t.evalCases.name })
      .from(t.evalRuns)
      .innerJoin(t.evalCases, eq(t.evalRuns.caseId, t.evalCases.id))
      .where(eq(t.evalCases.workspaceId, workspaceId))
      .orderBy(desc(t.evalRuns.ranAt))
      .limit(limit);
    return rows.map(({ run, caseName }) => toEvalRunRecord(run, caseName));
  }

  /** The set of case ids that have at least one run in `batchId` (AC-29 case-set overlap). */
  async caseIdsInBatch(batchId: string): Promise<Set<string>> {
    const rows = await this.db
      .selectDistinct({ caseId: t.evalRuns.caseId })
      .from(t.evalRuns)
      .where(eq(t.evalRuns.batchId, batchId));
    return new Set(rows.map((r) => r.caseId));
  }

  /** Case count per owner (agent/skill) for the whole workspace (workspace dashboard). */
  async caseCountsByOwner(workspaceId: string): Promise<OwnerCaseCount[]> {
    const rows = await this.db
      .select({ ownerKind: t.evalCases.ownerKind, ownerId: t.evalCases.ownerId, value: count() })
      .from(t.evalCases)
      .where(eq(t.evalCases.workspaceId, workspaceId))
      .groupBy(t.evalCases.ownerKind, t.evalCases.ownerId);
    return rows.map((r) => ({
      ownerKind: r.ownerKind as EvalOwnerKind,
      ownerId: r.ownerId,
      count: r.value,
    }));
  }
}
