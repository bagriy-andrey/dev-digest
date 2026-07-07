import { describe, it, expect } from 'vitest';
import {
  classifyFile,
  computeSplitSuggestion,
  findingLinesFor,
  buildSmartDiff,
} from './helpers.js';
import { SPLIT_TOO_BIG_LINES } from './constants.js';

describe('classifyFile', () => {
  const cases: [string, 'core' | 'wiring' | 'boilerplate'][] = [
    // boilerplate: lockfiles
    ['package-lock.json', 'boilerplate'],
    ['pnpm-lock.yaml', 'boilerplate'],
    ['sub/dir/yarn.lock', 'boilerplate'],
    // boilerplate: build/generated output dirs. `dist/index.js` also matches
    // the wiring "index.*" rule, but boilerplate has precedence.
    ['dist/index.js', 'boilerplate'],
    ['client/build/main.js', 'boilerplate'],
    // boilerplate: snapshots
    ['src/__snapshots__/Foo.test.ts.snap', 'boilerplate'],
    ['src/Foo.snap', 'boilerplate'],
    // boilerplate: drizzle snapshot meta
    ['server/src/db/migrations/meta/0001_snapshot.json', 'boilerplate'],
    // wiring
    ['package.json', 'wiring'],
    ['tsconfig.json', 'wiring'],
    ['tsconfig.build.json', 'wiring'],
    ['vitest.config.ts', 'wiring'],
    ['src/modules/foo/index.ts', 'wiring'],
    ['src/types/foo.d.ts', 'wiring'],
    ['.github/workflows/ci.yml', 'wiring'],
    ['Dockerfile', 'wiring'],
    // core
    ['src/modules/foo/service.ts', 'core'],
    ['src/modules/foo/helpers.ts', 'core'],
  ];

  it.each(cases)('classifies %s as %s', (path, expected) => {
    expect(classifyFile(path)).toBe(expected);
  });
});

describe('findingLinesFor', () => {
  it('collects, dedupes, and sorts start_lines for a given path', () => {
    const findings = [
      { file: 'src/a.ts', start_line: 40 },
      { file: 'src/a.ts', start_line: 10 },
      { file: 'src/a.ts', start_line: 10 },
      { file: 'src/b.ts', start_line: 5 },
    ];
    expect(findingLinesFor('src/a.ts', findings)).toEqual([10, 40]);
    expect(findingLinesFor('src/b.ts', findings)).toEqual([5]);
    expect(findingLinesFor('src/missing.ts', findings)).toEqual([]);
  });
});

describe('computeSplitSuggestion', () => {
  it('is not too_big below the line threshold, even with many core dirs', () => {
    const files = [
      { path: 'a/foo.ts', additions: 10, deletions: 0 },
      { path: 'b/bar.ts', additions: 10, deletions: 0 },
    ];
    const coreFiles = [{ path: 'a/foo.ts' }, { path: 'b/bar.ts' }];
    const result = computeSplitSuggestion(files, coreFiles);
    expect(result).toEqual({ too_big: false, total_lines: 20, proposed_splits: [] });
  });

  it('is not too_big above the line threshold with only 1 core dir', () => {
    const files = [{ path: 'a/foo.ts', additions: SPLIT_TOO_BIG_LINES + 1, deletions: 0 }];
    const coreFiles = [{ path: 'a/foo.ts' }];
    const result = computeSplitSuggestion(files, coreFiles);
    expect(result.too_big).toBe(false);
    expect(result.proposed_splits).toEqual([]);
  });

  it('proposes one split per core dir when too_big', () => {
    const files = [
      { path: 'a/foo.ts', additions: SPLIT_TOO_BIG_LINES + 1, deletions: 0 },
      { path: 'b/bar.ts', additions: 0, deletions: 0 },
      { path: 'b/baz.ts', additions: 0, deletions: 0 },
      { path: 'c/qux.ts', additions: 0, deletions: 0 },
    ];
    const coreFiles = [
      { path: 'a/foo.ts' },
      { path: 'b/bar.ts' },
      { path: 'b/baz.ts' },
      { path: 'c/qux.ts' },
    ];
    const result = computeSplitSuggestion(files, coreFiles);
    expect(result.too_big).toBe(true);
    expect(result.total_lines).toBe(SPLIT_TOO_BIG_LINES + 1);
    expect(result.proposed_splits).toEqual([
      { name: 'a', files: ['a/foo.ts'] },
      { name: 'b', files: ['b/bar.ts', 'b/baz.ts'] },
      { name: 'c', files: ['c/qux.ts'] },
    ]);
  });

  it('treats a path with no "/" as the "(root)" dir', () => {
    const files = [{ path: 'foo.ts', additions: SPLIT_TOO_BIG_LINES + 1, deletions: 0 }];
    const coreFiles = [{ path: 'foo.ts' }, { path: 'bar/baz.ts' }];
    const result = computeSplitSuggestion(files, coreFiles);
    expect(result.too_big).toBe(true);
    expect(result.proposed_splits.map((s) => s.name)).toEqual(['(root)', 'bar']);
  });
});

describe('buildSmartDiff', () => {
  it('always emits exactly 3 groups in core -> wiring -> boilerplate order', () => {
    const result = buildSmartDiff([], []);
    expect(result.groups.map((g) => g.role)).toEqual(['core', 'wiring', 'boilerplate']);
    expect(result.groups.every((g) => g.files.length === 0)).toBe(true);
    expect(result.split_suggestion).toEqual({
      too_big: false,
      total_lines: 0,
      proposed_splits: [],
    });
  });

  it('classifies files into their groups, preserving input order within a group', () => {
    const files = [
      { path: 'src/service.ts', additions: 5, deletions: 1 },
      { path: 'package-lock.json', additions: 100, deletions: 0 },
      { path: 'package.json', additions: 1, deletions: 0 },
      { path: 'src/helpers.ts', additions: 3, deletions: 0 },
    ];
    const result = buildSmartDiff(files, []);

    const core = result.groups.find((g) => g.role === 'core')!;
    expect(core.files.map((f) => f.path)).toEqual(['src/service.ts', 'src/helpers.ts']);

    const wiring = result.groups.find((g) => g.role === 'wiring')!;
    expect(wiring.files.map((f) => f.path)).toEqual(['package.json']);

    const boilerplate = result.groups.find((g) => g.role === 'boilerplate')!;
    expect(boilerplate.files.map((f) => f.path)).toEqual(['package-lock.json']);
  });

  it('sets pseudocode_summary to null on every file (no LLM call at this step)', () => {
    const files = [{ path: 'src/a.ts', additions: 1, deletions: 0 }];
    const result = buildSmartDiff(files, []);
    for (const group of result.groups) {
      for (const file of group.files) {
        expect(file.pseudocode_summary).toBeNull();
      }
    }
  });

  it('overlays finding_lines per file, deduped and sorted', () => {
    const files = [{ path: 'src/a.ts', additions: 1, deletions: 0 }];
    const findings = [
      { file: 'src/a.ts', start_line: 20 },
      { file: 'src/a.ts', start_line: 5 },
      { file: 'src/a.ts', start_line: 5 },
      { file: 'src/other.ts', start_line: 1 },
    ];
    const result = buildSmartDiff(files, findings);
    const core = result.groups.find((g) => g.role === 'core')!;
    expect(core.files[0]?.finding_lines).toEqual([5, 20]);
  });
});
