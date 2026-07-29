import { describe, it, expect } from 'vitest';
import type { EvalExpectation, EvalRunCounts, Finding } from '@devdigest/shared';
import { matches, scoreCase, aggregateBatch } from '../src/modules/evals/scorer.js';

/**
 * Hermetic tests for the pure `scorer.ts` module (SPEC-03 step 2) — the
 * whole of scoring, per spec §"Match and metric definitions". Zero DB, zero
 * provider.
 */

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: 'f1',
    file: 'src/a.ts',
    start_line: 10,
    end_line: 12,
    severity: 'CRITICAL',
    category: 'bug',
    title: 'Some finding',
    rationale: 'Because.',
    confidence: 0.9,
    ...overrides,
  } as Finding;
}

function expectation(overrides: Partial<EvalExpectation> = {}): EvalExpectation {
  return {
    kind: 'must_find',
    file: 'src/a.ts',
    start_line: 10,
    end_line: 12,
    ...overrides,
  } as EvalExpectation;
}

describe('matches', () => {
  it('returns false for adjacent-but-not-overlapping ranges', () => {
    const a = finding({ start_line: 10, end_line: 12 });
    const e = expectation({ start_line: 13, end_line: 15 });
    expect(matches(a, e)).toBe(false);
  });

  it('returns true when ranges touch by exactly one line', () => {
    const a = finding({ start_line: 10, end_line: 12 });
    const e = expectation({ start_line: 12, end_line: 15 });
    expect(matches(a, e)).toBe(true);
  });

  it('normalises a reversed expectation range before matching', () => {
    const a = finding({ start_line: 10, end_line: 12 });
    const e = expectation({ start_line: 12, end_line: 10 }); // reversed
    expect(matches(a, e)).toBe(true);
  });

  it('returns false for the same line range on a different file', () => {
    const a = finding({ file: 'src/a.ts', start_line: 10, end_line: 12 });
    const e = expectation({ file: 'src/b.ts', start_line: 10, end_line: 12 });
    expect(matches(a, e)).toBe(false);
  });

  it('still matches when severity/category/title differ on either side (AC-14)', () => {
    const a = finding({
      start_line: 10,
      end_line: 12,
      severity: 'SUGGESTION',
      category: 'style',
      title: 'Totally different title',
    });
    const e = expectation({
      start_line: 10,
      end_line: 12,
      severity: 'CRITICAL',
      category: 'bug',
      title: 'A completely unrelated title',
    });
    expect(matches(a, e)).toBe(true);
  });
});

describe('scoreCase', () => {
  it('passes when every must_find is matched and there is no noise', () => {
    const expectations = [expectation({ kind: 'must_find', start_line: 10, end_line: 12 })];
    const kept = [finding({ start_line: 10, end_line: 12 })];
    const result = scoreCase(expectations, kept, 0);
    expect(result.pass).toBe(true);
    expect(result.counts).toEqual({ must_find: 1, matched: 1, actual: 1, noise: 0, dropped: 0 });
  });

  it('fails when a must_find expectation is not matched', () => {
    const expectations = [expectation({ kind: 'must_find', start_line: 10, end_line: 12 })];
    const kept: Finding[] = [];
    const result = scoreCase(expectations, kept, 0);
    expect(result.pass).toBe(false);
    expect(result.counts.matched).toBe(0);
  });

  it('fails when a finding lands inside a must_not_flag region (noise)', () => {
    const expectations = [expectation({ kind: 'must_not_flag', start_line: 10, end_line: 12 })];
    const kept = [finding({ start_line: 11, end_line: 11 })];
    const result = scoreCase(expectations, kept, 0);
    expect(result.pass).toBe(false);
    expect(result.counts.noise).toBe(1);
  });

  it('an unrelated finding elsewhere in the diff is not noise (AC-16 — per-case half)', () => {
    const expectations = [expectation({ kind: 'must_not_flag', start_line: 10, end_line: 12 })];
    const kept = [finding({ start_line: 50, end_line: 51 })];
    const result = scoreCase(expectations, kept, 0);
    expect(result.pass).toBe(true);
    expect(result.counts.noise).toBe(0);
  });

  it('a case with no must_find expectations has a null recall (not 0, not 1)', () => {
    const expectations = [expectation({ kind: 'must_not_flag', start_line: 10, end_line: 12 })];
    const kept: Finding[] = [];
    const result = scoreCase(expectations, kept, 0);
    expect(result.recall).toBeNull();
    expect(result.counts.must_find).toBe(0);
  });

  it('empty expectations ([]) are legal and contribute to precision/citation but not recall', () => {
    const kept = [finding({ start_line: 1, end_line: 1 })];
    const result = scoreCase([], kept, 1);
    expect(result.recall).toBeNull();
    expect(result.precision).toBe(1); // no must_not_flag ⇒ nothing is noise
    expect(result.citation_accuracy).toBeCloseTo(0.5); // 1 kept / (1 kept + 1 dropped)
  });

  it('citation_accuracy is null when there are zero kept and zero dropped findings', () => {
    const result = scoreCase([], [], 0);
    expect(result.citation_accuracy).toBeNull();
  });

  it('precision is null when there are zero kept findings', () => {
    const result = scoreCase([], [], 3);
    expect(result.precision).toBeNull();
  });
});

describe('aggregateBatch', () => {
  function counts(overrides: Partial<EvalRunCounts>): EvalRunCounts {
    return { must_find: 0, matched: 0, actual: 0, noise: 0, dropped: 0, ...overrides };
  }

  it('computes recall over a fixture batch with known matches (AC-15)', () => {
    const rows = [
      counts({ must_find: 2, matched: 1 }),
      counts({ must_find: 3, matched: 3 }),
    ];
    const result = aggregateBatch(rows);
    // pooled: 4 matched / 5 must_find
    expect(result.recall).toBeCloseTo(4 / 5);
    expect(result.recall_na).toBe(false);
  });

  it('an unrelated finding elsewhere in the same diff leaves precision unaffected (AC-16)', () => {
    // A case with a must_not_flag region matched by no findings (no noise) plus
    // an unrelated finding elsewhere is scored upstream by scoreCase as noise:0 —
    // the row's `actual` includes it but `noise` does not, so precision stays 1.
    const rows = [counts({ actual: 1, noise: 0 })];
    const result = aggregateBatch(rows);
    expect(result.precision).toBe(1);
    expect(result.precision_na).toBe(false);
  });

  it('3 kept / 1 dropped ⇒ citation_accuracy 0.75 (AC-17)', () => {
    const rows = [counts({ actual: 3, dropped: 1 })];
    const result = aggregateBatch(rows);
    expect(result.citation_accuracy).toBe(0.75);
  });

  it('zero denominator ⇒ metric value 1 AND _na true, for all three metrics (AC-18)', () => {
    const rows = [counts({})];
    const result = aggregateBatch(rows);
    expect(result.recall).toBe(1);
    expect(result.recall_na).toBe(true);
    expect(result.precision).toBe(1);
    expect(result.precision_na).toBe(true);
    expect(result.citation_accuracy).toBe(1);
    expect(result.citation_accuracy_na).toBe(true);
  });

  it('a case with no must_find expectations contributes to neither recall numerator nor denominator (edge case 3, batch level)', () => {
    const rows = [
      counts({ must_find: 2, matched: 2 }), // a normal case, perfect recall
      counts({ must_find: 0, matched: 0 }), // a must_not_flag-only case
    ];
    const result = aggregateBatch(rows);
    // If the zero-must_find row polluted the denominator, this would not be 1.
    expect(result.recall).toBe(1);
    expect(result.recall_na).toBe(false);
  });

  it('empty ([]) expectations contribute to precision + citation_accuracy but not recall (edge case 14, batch level)', () => {
    const rows = [
      counts({ must_find: 1, matched: 1, actual: 1, dropped: 0 }), // a normal must_find case
      counts({ must_find: 0, matched: 0, actual: 2, noise: 0, dropped: 1 }), // an empty-expectations case
    ];
    const result = aggregateBatch(rows);
    expect(result.recall).toBe(1); // unaffected by the empty-expectations row
    // precision: (3 actual - 0 noise) / 3 actual = 1
    expect(result.precision).toBe(1);
    // citation_accuracy: 3 actual / (3 actual + 1 dropped)
    expect(result.citation_accuracy).toBeCloseTo(0.75);
  });

  it('pass is true iff all must_find matched AND zero noise (AC-19)', () => {
    expect(scoreCase([expectation({ kind: 'must_find' })], [finding()], 0).pass).toBe(true);
    expect(
      scoreCase(
        [expectation({ kind: 'must_find' }), expectation({ kind: 'must_find', start_line: 99, end_line: 99 })],
        [finding()],
        0,
      ).pass,
    ).toBe(false); // one must_find unmatched
    expect(
      scoreCase(
        [expectation({ kind: 'must_not_flag' })],
        [finding({ start_line: 10, end_line: 12 })],
        0,
      ).pass,
    ).toBe(false); // noise present
  });
});
