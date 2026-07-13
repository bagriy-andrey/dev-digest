/**
 * Blast Radius — behavioral unit tests for `RepoIntelService`'s persistent
 * blast path (`tryPersistentBlast`)'s NestJS decorator-routing support:
 * `extractNestRoutes`'s output reaching `impactedEndpoints`/`endpoints_affected`
 * via `file_facts.route_symbols`, and the method-scoped hop-1 attribution that
 * keeps one controller's unrelated routes from bleeding into each other.
 *
 * No Postgres, no clone: `RepoIntelRepository` (`svc.repo`) is patched
 * directly, mirroring the established hermetic pattern in
 * `repo-intel-blast-2hop.test.ts`.
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

describe('tryPersistentBlast — NestJS decorator-route attribution', () => {
  it('surfaces a decorator-based route via file_facts.route_symbols (the "0 endpoints" bug fix)', async () => {
    const svc = buildService({
      getSymbolRows: async (_repoId, paths) => {
        if (paths.includes('pagination.ts')) {
          return [
            { path: 'pagination.ts', name: 'paginateItems', kind: 'function', line: 1, endLine: 5, exported: true, signature: null },
          ];
        }
        if (paths.includes('portfolio.controller.ts')) {
          return [
            { path: 'portfolio.controller.ts', name: 'getAllocation', kind: 'method', line: 5, endLine: 10, exported: true, signature: null },
          ];
        }
        return [];
      },
      getResolvedCallers: async () => [
        { fromPath: 'portfolio.controller.ts', toSymbol: 'paginateItems', line: 7, rank: 1 },
      ],
      getFileFacts: async (_repoId, files) =>
        files.includes('portfolio.controller.ts')
          ? [
              {
                filePath: 'portfolio.controller.ts',
                endpoints: ['GET /portfolio/allocation'],
                crons: [],
                routeSymbols: { getAllocation: ['GET /portfolio/allocation'] },
              },
            ]
          : [],
    });

    const result = await callTryPersistentBlast(svc, 'r1', ['pagination.ts']);

    expect(result!.degraded).toBe(false);
    expect(result!.endpointsBySymbol?.['paginateItems']).toEqual(['GET /portfolio/allocation']);
    expect(result!.impactedEndpoints).toContain('GET /portfolio/allocation');
  });

  it('attributes only the calling method\'s own route, not every route in the controller file', async () => {
    // Two unrelated handlers in ONE controller file — only getAllocation actually
    // calls the changed symbol; getPerformance's route must NOT leak in.
    const svc = buildService({
      getSymbolRows: async (_repoId, paths) => {
        if (paths.includes('pagination.ts')) {
          return [
            { path: 'pagination.ts', name: 'paginateItems', kind: 'function', line: 1, endLine: 5, exported: true, signature: null },
          ];
        }
        if (paths.includes('portfolio.controller.ts')) {
          return [
            { path: 'portfolio.controller.ts', name: 'getAllocation', kind: 'method', line: 5, endLine: 10, exported: true, signature: null },
            { path: 'portfolio.controller.ts', name: 'getPerformance', kind: 'method', line: 12, endLine: 18, exported: true, signature: null },
          ];
        }
        return [];
      },
      // Only getAllocation's body (line 7, between line 5 and 12) calls paginateItems.
      getResolvedCallers: async () => [
        { fromPath: 'portfolio.controller.ts', toSymbol: 'paginateItems', line: 7, rank: 1 },
      ],
      getFileFacts: async (_repoId, files) =>
        files.includes('portfolio.controller.ts')
          ? [
              {
                filePath: 'portfolio.controller.ts',
                endpoints: ['GET /portfolio/allocation', 'GET /portfolio/performance'],
                crons: [],
                routeSymbols: {
                  getAllocation: ['GET /portfolio/allocation'],
                  getPerformance: ['GET /portfolio/performance'],
                },
              },
            ]
          : [],
    });

    const result = await callTryPersistentBlast(svc, 'r1', ['pagination.ts']);

    expect(result!.endpointsBySymbol?.['paginateItems']).toEqual(['GET /portfolio/allocation']);
    expect(result!.endpointsBySymbol?.['paginateItems']).not.toContain('GET /portfolio/performance');
  });

  it('falls back to the file-level endpoints list when the caller is not itself a decorated handler', async () => {
    // Common real shape: a SERVICE method (undecorated) calls the changed
    // symbol directly; the controller is one hop further away. The service
    // file has no route_symbols entry for its own method, so attribution
    // falls back to whatever flat `endpoints` the file carries (empty here —
    // services don't declare routes) rather than silently dropping data.
    const svc = buildService({
      getSymbolRows: async (_repoId, paths) => {
        if (paths.includes('pagination.ts')) {
          return [
            { path: 'pagination.ts', name: 'paginateItems', kind: 'function', line: 1, endLine: 5, exported: true, signature: null },
          ];
        }
        if (paths.includes('portfolio.service.ts')) {
          return [
            { path: 'portfolio.service.ts', name: 'findAllForUser', kind: 'method', line: 3, endLine: 9, exported: true, signature: null },
          ];
        }
        return [];
      },
      getResolvedCallers: async () => [
        { fromPath: 'portfolio.service.ts', toSymbol: 'paginateItems', line: 5, rank: 1 },
      ],
      getFileFacts: async (_repoId, files) =>
        files.includes('portfolio.service.ts')
          ? [{ filePath: 'portfolio.service.ts', endpoints: [], crons: [], routeSymbols: {} }]
          : [],
    });

    const result = await callTryPersistentBlast(svc, 'r1', ['pagination.ts']);

    expect(result!.endpointsBySymbol?.['paginateItems']).toEqual([]);
    expect(result!.callers).toHaveLength(1);
    expect(result!.callers[0]!.symbol).toBe('findAllForUser');
  });
});
