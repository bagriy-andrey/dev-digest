/**
 * Blast Radius — behavioral unit tests for `RepoIntelService`'s persistent
 * blast path (`tryPersistentBlast`), covering the new 2-hop endpoint/cron
 * reachability extension and the per-symbol caller cap fix.
 *
 * No Postgres, no clone: `RepoIntelRepository` (`svc.repo`) is patched
 * directly, mirroring the established hermetic pattern in
 * `repo-intel-facade-degraded.test.ts`.
 */
import { describe, it, expect } from 'vitest';
import { RepoIntelService } from '../src/modules/repo-intel/service.js';
import type { IndexState } from '../src/modules/repo-intel/types.js';
import type {
  FullSymbolRow,
  ResolvedCallerRow,
  IndexerEdgeRow,
  IndexerFileFactsRow,
} from '../src/modules/repo-intel/repository.js';

interface RepoStub {
  tryGetIndexState: (repoId: string) => Promise<IndexState | null>;
  getSymbolRows: (repoId: string, paths: string[]) => Promise<FullSymbolRow[]>;
  getResolvedCallers: (
    repoId: string,
    declFiles: string[],
    names: string[],
  ) => Promise<ResolvedCallerRow[]>;
  getEdges: (repoId: string) => Promise<IndexerEdgeRow[]>;
  getFileFacts: (repoId: string, files: string[]) => Promise<IndexerFileFactsRow[]>;
}

const FULL_STATE: IndexState = {
  repoId: 'r1',
  status: 'full',
  filesIndexed: 10,
  filesSkipped: 0,
  durationMs: 0,
  lastIndexedSha: 'abc',
  indexerVersion: 2,
  updatedAt: new Date(),
};

function buildService(repoStub: Partial<RepoStub>): RepoIntelService {
  const container = { config: { repoIntelEnabled: true }, db: {} as never } as never;
  const svc = new RepoIntelService(container);
  (svc as unknown as { repo: RepoStub }).repo = {
    tryGetIndexState: async () => FULL_STATE,
    getSymbolRows: async () => [],
    getResolvedCallers: async () => [],
    getEdges: async () => [],
    getFileFacts: async () => [],
    ...repoStub,
  };
  return svc;
}

function callTryPersistentBlast(svc: RepoIntelService, repoId: string, changedFiles: string[]) {
  return (
    svc as unknown as {
      tryPersistentBlast: (r: string, f: string[]) => ReturnType<RepoIntelService['getBlastRadius']>;
    }
  ).tryPersistentBlast(repoId, changedFiles);
}

describe('tryPersistentBlast — 2-hop reachability + per-symbol caller cap', () => {
  it('surfaces an endpoint reachable only via a 2-hop import chain (route -> wrapper -> changed file)', async () => {
    const svc = buildService({
      getSymbolRows: async (_repoId, paths) => {
        if (paths.includes('changed.ts')) {
          return [
            { path: 'changed.ts', name: 'rateLimit', kind: 'function', line: 1, endLine: 5, exported: true, signature: 'function rateLimit()' },
          ];
        }
        if (paths.includes('caller.ts')) {
          return [
            { path: 'caller.ts', name: 'handler', kind: 'function', line: 1, endLine: 20, exported: true, signature: null },
          ];
        }
        return [];
      },
      getResolvedCallers: async () => [{ fromPath: 'caller.ts', toSymbol: 'rateLimit', line: 10, rank: 5 }],
      getEdges: async () => [
        { fromFile: 'wrapper.ts', toFile: 'changed.ts' },
        { fromFile: 'route.ts', toFile: 'wrapper.ts' },
      ],
      getFileFacts: async (_repoId, files) =>
        files.includes('route.ts') ? [{ filePath: 'route.ts', endpoints: ['GET /api/x'], crons: [] }] : [],
    });

    const result = await callTryPersistentBlast(svc, 'r1', ['changed.ts']);

    expect(result).not.toBeNull();
    expect(result!.degraded).toBe(false);
    // The endpoint is 2 hops away (route.ts -> wrapper.ts -> changed.ts), not a
    // direct caller file — this is exactly the gap the 2-hop walk closes.
    expect(result!.endpointsBySymbol?.['rateLimit']).toEqual(['GET /api/x']);
    expect(result!.impactedEndpoints).toContain('GET /api/x');
    // The visible callers[] array stays hop-1-only: route.ts/wrapper.ts must
    // NOT appear as callers, only the direct caller.ts.
    expect(result!.callers).toHaveLength(1);
    expect(result!.callers[0]!.file).toBe('caller.ts');
  });

  it('a changed symbol with a direct caller that has no endpoint yields an empty array (no false positives)', async () => {
    const svc = buildService({
      getSymbolRows: async (_repoId, paths) =>
        paths.includes('changed.ts')
          ? [{ path: 'changed.ts', name: 'helper', kind: 'function', line: 1, endLine: 5, exported: true, signature: null }]
          : [],
      getResolvedCallers: async () => [{ fromPath: 'caller.ts', toSymbol: 'helper', line: 3, rank: 1 }],
      getEdges: async () => [],
      getFileFacts: async () => [],
    });

    const result = await callTryPersistentBlast(svc, 'r1', ['changed.ts']);

    expect(result!.endpointsBySymbol?.['helper']).toEqual([]);
    expect(result!.cronsBySymbol?.['helper']).toEqual([]);
  });

  it('caps callers PER changed symbol (20 each), not globally across all symbols', async () => {
    const manyCallers: ResolvedCallerRow[] = Array.from({ length: 25 }, (_, i) => ({
      fromPath: `caller${i}.ts`,
      toSymbol: 'busy',
      line: i + 1,
      rank: 25 - i,
    }));
    const fewCallers: ResolvedCallerRow[] = [
      { fromPath: 'a.ts', toSymbol: 'quiet', line: 1, rank: 3 },
      { fromPath: 'b.ts', toSymbol: 'quiet', line: 1, rank: 2 },
      { fromPath: 'c.ts', toSymbol: 'quiet', line: 1, rank: 1 },
    ];

    const svc = buildService({
      getSymbolRows: async (_repoId, paths) => {
        if (paths.includes('changed.ts')) {
          return [
            { path: 'changed.ts', name: 'busy', kind: 'function', line: 1, endLine: 2, exported: true, signature: null },
            { path: 'changed.ts', name: 'quiet', kind: 'function', line: 3, endLine: 4, exported: true, signature: null },
          ];
        }
        return [];
      },
      getResolvedCallers: async () => [...manyCallers, ...fewCallers],
    });

    const result = await callTryPersistentBlast(svc, 'r1', ['changed.ts']);

    const busyCallers = result!.callers.filter((c) => c.viaSymbol === 'busy');
    const quietCallers = result!.callers.filter((c) => c.viaSymbol === 'quiet');
    expect(busyCallers).toHaveLength(20); // capped, not the raw 25
    expect(quietCallers).toHaveLength(3); // untouched — `busy`'s cap doesn't steal `quiet`'s budget
  });

  it('returns null (falls back to ripgrep) when the index state is not full/partial', async () => {
    const svc = buildService({ tryGetIndexState: async () => null });
    const result = await callTryPersistentBlast(svc, 'r1', ['changed.ts']);
    expect(result).toBeNull();
  });

  it('an empty edges graph yields empty reachable sets — hop-1 behavior unaffected', async () => {
    const svc = buildService({
      getSymbolRows: async (_repoId, paths) =>
        paths.includes('changed.ts')
          ? [{ path: 'changed.ts', name: 'fn', kind: 'function', line: 1, endLine: 2, exported: true, signature: null }]
          : [],
      getResolvedCallers: async () => [{ fromPath: 'caller.ts', toSymbol: 'fn', line: 1, rank: 1 }],
      getEdges: async () => [],
      getFileFacts: async (_repoId, files) =>
        files.includes('caller.ts') ? [{ filePath: 'caller.ts', endpoints: ['POST /api/y'], crons: [] }] : [],
    });

    const result = await callTryPersistentBlast(svc, 'r1', ['changed.ts']);
    expect(result!.endpointsBySymbol?.['fn']).toEqual(['POST /api/y']);
    expect(result!.degraded).toBe(false);
  });
});
