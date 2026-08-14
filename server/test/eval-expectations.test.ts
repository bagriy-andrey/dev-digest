import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  parseExpectations,
  normalizedRange,
  ExpectationValidationError,
} from '../src/modules/evals/expectations.js';

/**
 * Hermetic tests for the pure `expectations.ts` module (SPEC-03 step 2).
 * Zero DB, zero provider — see the purity assertion at the bottom of this
 * file (AC-13's purity half).
 */

describe('parseExpectations', () => {
  it('treats null as an empty array (a must_not_flag-only case with empty expected_output is legal)', () => {
    expect(parseExpectations(null)).toEqual([]);
  });

  it('treats undefined as an empty array', () => {
    expect(parseExpectations(undefined)).toEqual([]);
  });

  it('accepts an empty array literally (edge case 14)', () => {
    expect(parseExpectations([])).toEqual([]);
  });

  it('accepts an entry with no kind and defaults it to must_find', () => {
    const [entry] = parseExpectations([{ file: 'a.ts', start_line: 10 }]);
    expect(entry.kind).toBe('must_find');
  });

  it('accepts a missing end_line and treats it as start_line at the caller (raw parse keeps it absent; normalizedRange fills it in)', () => {
    const [entry] = parseExpectations([{ file: 'a.ts', start_line: 10 }]);
    expect(entry.end_line).toBeUndefined();
    expect(normalizedRange(entry)).toEqual([10, 10]);
  });

  it('accepts an explicit must_not_flag kind', () => {
    const [entry] = parseExpectations([
      { kind: 'must_not_flag', file: 'a.ts', start_line: 1, end_line: 5 },
    ]);
    expect(entry.kind).toBe('must_not_flag');
  });

  it('rejects a malformed entry with a message naming the first invalid entry index', () => {
    let caught: unknown;
    try {
      parseExpectations([
        { file: 'a.ts', start_line: 1 }, // valid
        { file: 'b.ts' }, // invalid — missing start_line (index 1)
      ]);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ExpectationValidationError);
    expect((caught as Error).message).toContain('index 1');
  });

  it('rejects an entry with a wrong-typed field, naming its path', () => {
    let caught: unknown;
    try {
      parseExpectations([{ file: 'a.ts', start_line: 'not-a-number' }]);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ExpectationValidationError);
    expect((caught as Error).message).toContain('index 0');
    expect((caught as Error).message).toContain('start_line');
  });

  it('rejects a completely non-array input', () => {
    expect(() => parseExpectations({ not: 'an array' })).toThrow(ExpectationValidationError);
  });
});

describe('normalizedRange', () => {
  it('defaults end to start when end_line is absent', () => {
    expect(normalizedRange({ start_line: 7 })).toEqual([7, 7]);
  });

  it('defaults end to start when end_line is null', () => {
    expect(normalizedRange({ start_line: 7, end_line: null })).toEqual([7, 7]);
  });

  it('keeps a well-ordered range as-is', () => {
    expect(normalizedRange({ start_line: 3, end_line: 8 })).toEqual([3, 8]);
  });

  it('swaps a reversed range so the first element is <= the second', () => {
    expect(normalizedRange({ start_line: 8, end_line: 3 })).toEqual([3, 8]);
  });
});

/**
 * Static purity assertion (AC-13's purity half): neither `expectations.ts`
 * nor `scorer.ts` may import from `drizzle-orm`, `db/`, `adapters/`, or any
 * provider module. Read the sources directly rather than trusting a
 * transitive typecheck, since a re-export elsewhere could hide a violation.
 */
describe('purity — expectations.ts / scorer.ts import zero I/O', () => {
  const FORBIDDEN = [/from ['"]drizzle-orm/, /from ['"].*\/db\//, /from ['"].*\/adapters\//, /provider/i];

  it('expectations.ts has no forbidden imports', () => {
    const path = fileURLToPath(new URL('../src/modules/evals/expectations.ts', import.meta.url));
    const source = readFileSync(path, 'utf8');
    const importLines = source
      .split('\n')
      .filter((line) => line.trim().startsWith('import'));
    for (const line of importLines) {
      for (const pattern of FORBIDDEN) {
        expect(pattern.test(line)).toBe(false);
      }
    }
  });

  it('scorer.ts has no forbidden imports', () => {
    const path = fileURLToPath(new URL('../src/modules/evals/scorer.ts', import.meta.url));
    const source = readFileSync(path, 'utf8');
    const importLines = source
      .split('\n')
      .filter((line) => line.trim().startsWith('import'));
    for (const line of importLines) {
      for (const pattern of FORBIDDEN) {
        expect(pattern.test(line)).toBe(false);
      }
    }
  });
});
