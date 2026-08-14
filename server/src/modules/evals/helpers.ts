import type { EvalCase, EvalOwnerKind, EvalRunRecord } from '@devdigest/shared';
import type * as t from '../../db/schema.js';

/**
 * Row → DTO mappers for the eval module (SPEC-03 step 3). Kept out of
 * `repository.ts` proper per the plan so a future `case-service.ts`/`runner.ts`
 * (step 4) can reuse them without pulling in the whole repository surface.
 *
 * No business logic here — purely shape translation, including the one
 * mandatory fix-up the contract itself cannot express: `input_diff` is a
 * nullable DB column but a non-nullable `z.string()` on the wire (spec edge
 * case 15). NEVER loosen `EvalCase.input_diff` to accommodate a null — map it
 * at this boundary instead.
 */

export type EvalCaseRow = typeof t.evalCases.$inferSelect;
export type EvalRunRow = typeof t.evalRuns.$inferSelect;

export function toEvalCase(row: EvalCaseRow): EvalCase {
  return {
    id: row.id,
    owner_kind: row.ownerKind as EvalOwnerKind,
    owner_id: row.ownerId,
    name: row.name,
    // Edge case 15: null in the DB (never written, or a pre-existing row) must
    // never surface as null on the wire — the contract requires a string.
    input_diff: row.inputDiff ?? '',
    input_files: row.inputFiles,
    input_meta: row.inputMeta,
    expected_output: row.expectedOutput,
    notes: row.notes,
  };
}

export function toEvalRunRecord(row: EvalRunRow, caseName?: string | null): EvalRunRecord {
  return {
    id: row.id,
    case_id: row.caseId,
    case_name: caseName ?? null,
    ran_at: row.ranAt.toISOString(),
    actual_output: row.actualOutput,
    pass: row.pass,
    recall: row.recall,
    precision: row.precision,
    citation_accuracy: row.citationAccuracy,
    duration_ms: row.durationMs,
    cost_usd: row.costUsd,
    batch_id: row.batchId,
    agent_version: row.agentVersion,
  };
}
