import type { EvalExpectation, EvalRunCounts, Finding } from '@devdigest/shared';
import { normalizedRange } from './expectations.js';

/**
 * The whole of scoring (SPEC-03 §"Match and metric definitions"), verbatim.
 * Pure, zero I/O, zero LLM calls (AC-13) — this is the entire scoring path;
 * neither this file nor `expectations.ts` imports from `drizzle-orm`, `db/`,
 * `adapters/`, or any provider module.
 */

/** The minimal shape `matches` needs from an actual (kept) finding. */
export interface MatchableFinding {
  file: string;
  start_line: number;
  end_line: number;
}

/**
 * `a` matches `e` iff their files are equal AND their (normalised) line
 * ranges intersect. Severity/category/title on either side are NEVER
 * consulted (AC-14) — only `file`/`start_line`/`end_line` participate.
 */
export function matches(a: MatchableFinding, e: EvalExpectation): boolean {
  if (a.file !== e.file) return false;
  const [aStart, aEnd] = normalizedRange(a);
  const [eStart, eEnd] = normalizedRange(e);
  return Math.max(aStart, eStart) <= Math.min(aEnd, eEnd);
}

export interface ScoredCase {
  counts: EvalRunCounts;
  pass: boolean;
  recall: number | null;
  precision: number | null;
  citation_accuracy: number | null;
}

/**
 * Score one case: `expectations` is the case's parsed `expected_output`,
 * `kept` are the review outcome's kept (post-grounding) findings, and
 * `droppedCount` is the number the grounding gate dropped.
 *
 * Per-case metrics are `null` when their denominator is 0 (the ROW level —
 * the batch level substitutes 1 + an `_na` flag, see `aggregateBatch`).
 */
export function scoreCase(
  expectations: EvalExpectation[],
  kept: Finding[],
  droppedCount: number,
): ScoredCase {
  const mustFind = expectations.filter((e) => (e.kind ?? 'must_find') === 'must_find');
  const mustNotFlag = expectations.filter((e) => e.kind === 'must_not_flag');

  const matchedCount = mustFind.filter((e) => kept.some((a) => matches(a, e))).length;
  const noiseCount = kept.filter((a) => mustNotFlag.some((e) => matches(a, e))).length;

  const counts: EvalRunCounts = {
    must_find: mustFind.length,
    matched: matchedCount,
    actual: kept.length,
    noise: noiseCount,
    dropped: droppedCount,
  };

  const pass = matchedCount === mustFind.length && noiseCount === 0;

  const recall = mustFind.length === 0 ? null : matchedCount / mustFind.length;
  const precision = kept.length === 0 ? null : (kept.length - noiseCount) / kept.length;
  const citationDenominator = kept.length + droppedCount;
  const citation_accuracy = citationDenominator === 0 ? null : kept.length / citationDenominator;

  return { counts, pass, recall, precision, citation_accuracy };
}

export interface AggregatedBatch {
  recall: number;
  precision: number;
  citation_accuracy: number;
  recall_na: boolean;
  precision_na: boolean;
  citation_accuracy_na: boolean;
}

/**
 * Micro-averaged batch aggregate — POOLED numerators over pooled
 * denominators, NOT the mean of each row's `recall`/`precision`/
 * `citation_accuracy` (a case with many expectations weighs proportionally
 * more than one with a single expectation). Any zero denominator ⇒ that
 * metric's value is `1` and its `_na` flag is `true` (AC-18).
 */
export function aggregateBatch(rows: EvalRunCounts[]): AggregatedBatch {
  let mustFindSum = 0;
  let matchedSum = 0;
  let actualSum = 0;
  let noiseSum = 0;
  let droppedSum = 0;

  for (const row of rows) {
    mustFindSum += row.must_find;
    matchedSum += row.matched;
    actualSum += row.actual;
    noiseSum += row.noise;
    droppedSum += row.dropped;
  }

  const recall_na = mustFindSum === 0;
  const precision_na = actualSum === 0;
  const citation_accuracy_na = actualSum + droppedSum === 0;

  return {
    recall: recall_na ? 1 : matchedSum / mustFindSum,
    precision: precision_na ? 1 : (actualSum - noiseSum) / actualSum,
    citation_accuracy: citation_accuracy_na ? 1 : actualSum / (actualSum + droppedSum),
    recall_na,
    precision_na,
    citation_accuracy_na,
  };
}
