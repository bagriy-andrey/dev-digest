import { EvalExpectations, type EvalExpectation } from '@devdigest/shared';

/**
 * Pure domain module — parses/normalises the `expected_output` array
 * (NEW-1, `EvalExpectation`). Zero I/O, zero database, zero LLM calls. The
 * HTTP-status mapping (400 vs 422) happens in the service layer (step 4),
 * never here — this file only throws a plain `Error`.
 */

/** A range-shaped value — either an `EvalExpectation` or an actual finding. */
export interface RangeLike {
  start_line: number;
  end_line?: number | null;
}

/**
 * Thrown by `parseExpectations` when `raw` fails `EvalExpectations.safeParse`.
 * The message names the first invalid entry's index and the field path
 * within it (AC-8's unit half).
 */
export class ExpectationValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExpectationValidationError';
  }
}

/**
 * Parse `expected_output` (a case's raw, unknown-typed stored value) into a
 * validated `EvalExpectation[]`. `null`/`undefined` is treated as `[]` — a
 * `must_not_flag`-only case with no expectations at all is legal (edge case
 * 14). On any other validation failure, throws `ExpectationValidationError`
 * naming the FIRST invalid entry's index and field path.
 */
export function parseExpectations(raw: unknown): EvalExpectation[] {
  if (raw === null || raw === undefined) return [];

  const result = EvalExpectations.safeParse(raw);
  if (result.success) return result.data;

  const [firstIssue] = result.error.issues;
  const message = firstIssue?.message ?? 'invalid entry';
  const [maybeIndex, ...rest] = firstIssue?.path ?? [];
  const index = typeof maybeIndex === 'number' ? maybeIndex : 0;
  const fieldPath = rest.length > 0 ? rest.join('.') : '(entry)';
  throw new ExpectationValidationError(
    `Invalid expected_output entry at index ${index}, path "${fieldPath}": ${message}`,
  );
}

/**
 * `[start, end]` for a range-shaped value, with `end_line` defaulting to
 * `start_line` when absent, and swapped so the first element is always
 * ≤ the second ("ranges normalised so start ≤ end" — spec §Match and metric
 * definitions).
 */
export function normalizedRange(e: RangeLike): [number, number] {
  const start = e.start_line;
  const end = e.end_line ?? start;
  return start <= end ? [start, end] : [end, start];
}
