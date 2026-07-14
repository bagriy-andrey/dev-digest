/**
 * Blast Radius — pure-logic unit tests for the reverse-import-graph
 * reachability walk (`blast-reachability.ts`). No DB, no clone: pins the BFS
 * direction, depth cap, seed exclusion, and visited-cap behavior.
 */
import { describe, it, expect } from 'vitest';
import { reverseReachableFiles } from '../src/modules/repo-intel/blast-reachability.js';

describe('reverseReachableFiles', () => {
  it('returns an empty set per seed when there are no edges', () => {
    const result = reverseReachableFiles([], ['a.ts', 'b.ts'], 2, 500);
    expect(result.get('a.ts')).toEqual(new Set());
    expect(result.get('b.ts')).toEqual(new Set());
  });

  it('finds a 1-hop importer (direct)', () => {
    // caller.ts imports changed.ts
    const edges = [{ fromFile: 'caller.ts', toFile: 'changed.ts' }];
    const result = reverseReachableFiles(edges, ['changed.ts'], 2, 500);
    expect(result.get('changed.ts')).toEqual(new Set(['caller.ts']));
  });

  it('finds a 2-hop importer (importer of the importer)', () => {
    // route.ts -> wrapper.ts -> changed.ts
    const edges = [
      { fromFile: 'wrapper.ts', toFile: 'changed.ts' },
      { fromFile: 'route.ts', toFile: 'wrapper.ts' },
    ];
    const result = reverseReachableFiles(edges, ['changed.ts'], 2, 500);
    expect(result.get('changed.ts')).toEqual(new Set(['wrapper.ts', 'route.ts']));
  });

  it('does NOT include a 3-hop importer when depth=2', () => {
    const edges = [
      { fromFile: 'wrapper.ts', toFile: 'changed.ts' },
      { fromFile: 'route.ts', toFile: 'wrapper.ts' },
      { fromFile: 'far.ts', toFile: 'route.ts' },
    ];
    const result = reverseReachableFiles(edges, ['changed.ts'], 2, 500);
    expect(result.get('changed.ts')?.has('wrapper.ts')).toBe(true);
    expect(result.get('changed.ts')?.has('route.ts')).toBe(true);
    expect(result.get('changed.ts')?.has('far.ts')).toBe(false);
  });

  it('excludes the seed itself, even under an import cycle', () => {
    const edges = [
      { fromFile: 'a.ts', toFile: 'changed.ts' },
      { fromFile: 'changed.ts', toFile: 'a.ts' }, // cycle back to the seed
    ];
    const result = reverseReachableFiles(edges, ['changed.ts'], 2, 500);
    expect(result.get('changed.ts')?.has('changed.ts')).toBe(false);
    expect(result.get('changed.ts')?.has('a.ts')).toBe(true);
  });

  it('honors the cap, bounding the reachable set size per seed', () => {
    const edges = Array.from({ length: 10 }, (_, i) => ({
      fromFile: `f${i}.ts`,
      toFile: 'changed.ts',
    }));
    const result = reverseReachableFiles(edges, ['changed.ts'], 2, 3);
    expect(result.get('changed.ts')?.size).toBeLessThanOrEqual(3);
  });

  it('computes independent reachable sets per seed (no cross-contamination)', () => {
    const edges = [
      { fromFile: 'x.ts', toFile: 'a.ts' },
      { fromFile: 'y.ts', toFile: 'b.ts' },
    ];
    const result = reverseReachableFiles(edges, ['a.ts', 'b.ts'], 2, 500);
    expect(result.get('a.ts')).toEqual(new Set(['x.ts']));
    expect(result.get('b.ts')).toEqual(new Set(['y.ts']));
  });

  it('a file that imports its own seed multiple ways is only counted once', () => {
    const edges = [
      { fromFile: 'wrapper.ts', toFile: 'changed.ts' },
      { fromFile: 'route.ts', toFile: 'wrapper.ts' },
      { fromFile: 'route.ts', toFile: 'changed.ts' }, // also a direct importer
    ];
    const result = reverseReachableFiles(edges, ['changed.ts'], 2, 500);
    expect(result.get('changed.ts')).toEqual(new Set(['wrapper.ts', 'route.ts']));
  });
});
