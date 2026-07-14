/**
 * Blast Radius — behavioral unit tests for `RepoIntelService`'s persistent blast path
 * (`tryPersistentBlast`)'s PR-branch-only symbol visibility fix
 * (`server/specs/blast-radius-pr-branch-symbols.md`):
 *   - Phase 1: a file this PR ADDS (zero rows in the persisted `symbols` table) becomes visible
 *     via its raw GitHub patch, reconstructed and re-scanned with the same extractors the real
 *     indexer runs.
 *   - Phase 2: a file this PR MODIFIES can surface a NEW call site (to a symbol only introduced
 *     by this same PR) by applying its patch to the currently-indexed base content and
 *     re-scanning for references.
 *
 * No Postgres, no clone: `RepoIntelRepository` (`svc.repo`) is patched directly, mirroring
 * `repo-intel-blast-2hop.test.ts`/`repo-intel-blast-nest.test.ts`'s established hermetic pattern.
 * `container.git.readFile` is stubbed for Phase 2's base-content read.
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
  getRepoBasics: (repoId: string) => Promise<{ owner: string; name: string; clonePath: string | null } | null>;
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

function buildService(repoStub: Partial<RepoStub>, gitReadFile?: (ref: unknown, path: string) => Promise<string>) {
  const container = {
    config: { repoIntelEnabled: true },
    db: {} as never,
    git: { readFile: gitReadFile ?? (async () => { throw new Error('unexpected readFile'); }) },
  } as never;
  const svc = new RepoIntelService(container);
  (svc as unknown as { repo: RepoStub }).repo = {
    tryGetIndexState: async () => FULL_STATE,
    getSymbolRows: async () => [],
    getResolvedCallers: async () => [],
    getEdges: async () => [],
    getFileFacts: async () => [],
    getRepoBasics: async () => ({ owner: 'acme', name: 'widgets', clonePath: '/clone' }),
    ...repoStub,
  };
  return svc;
}

function getBlastRadius(
  svc: RepoIntelService,
  repoId: string,
  changedFiles: string[],
  patchesByFile: Record<string, string>,
) {
  return svc.getBlastRadius(repoId, changedFiles, patchesByFile);
}

// Real GitHub patch for a brand-new file, apps/api/src/auth/get-authenticated-user-id.ts,
// from bagriy-andrey/ai-stock-app PR #5.
const ADDED_FILE_PATCH =
  '@@ -0,0 +1,12 @@\n' +
  '+import { UnauthorizedException } from "@nestjs/common";\n' +
  '+import type { AuthenticatedRequest } from "./authenticated-request";\n' +
  '+\n' +
  '+export function getAuthenticatedUserId(request: AuthenticatedRequest): string {\n' +
  '+  if (!request.user) {\n' +
  '+    throw new UnauthorizedException(\n' +
  '+      "Authenticated request is missing user payload",\n' +
  '+    );\n' +
  '+  }\n' +
  '+\n' +
  '+  return request.user.sub;\n' +
  '+}';

describe('tryPersistentBlast — PR-branch-only symbol visibility (Phase 1)', () => {
  it('surfaces a symbol declared ONLY in an added-file patch, with zero persisted symbol rows', async () => {
    const svc = buildService({
      getSymbolRows: async () => [], // nothing indexed anywhere — file never merged to main
    });

    const result = await getBlastRadius(svc, 'r1', ['auth/get-authenticated-user-id.ts'], {
      'auth/get-authenticated-user-id.ts': ADDED_FILE_PATCH,
    });

    expect(result.degraded).toBe(false);
    expect(result.changedSymbols.map((s) => s.name)).toContain('getAuthenticatedUserId');
    expect(result.changedSymbols.find((s) => s.name === 'getAuthenticatedUserId')?.file).toBe(
      'auth/get-authenticated-user-id.ts',
    );
  });

  it('does NOT run Phase 1 for a file the persisted index already covers', async () => {
    const svc = buildService({
      getSymbolRows: async (_repoId, paths) =>
        paths.includes('already-indexed.ts')
          ? [{ path: 'already-indexed.ts', name: 'existingFn', kind: 'function', line: 1, endLine: 2, exported: true, signature: null }]
          : [],
    });

    // Even though a patch is supplied, the file has persisted rows, so Phase 1's extractor never
    // runs on it — no ephemeral symbol/fact should appear that wasn't already in the index.
    const result = await getBlastRadius(svc, 'r1', ['already-indexed.ts'], {
      'already-indexed.ts': ADDED_FILE_PATCH, // deliberately wrong content — must be ignored
    });

    expect(result.changedSymbols).toEqual([{ file: 'already-indexed.ts', name: 'existingFn', kind: 'function' }]);
    expect(result.changedSymbols.map((s) => s.name)).not.toContain('getAuthenticatedUserId');
  });

  it('a PR with no patch hint for an unindexed file stays exactly as degraded as before this fix', async () => {
    const svc = buildService({ getSymbolRows: async () => [] });
    const result = await getBlastRadius(svc, 'r1', ['unindexed.ts'], {}); // no patch supplied
    expect(result.changedSymbols).toEqual([]);
  });
});

describe('tryPersistentBlast — PR-branch-only caller visibility (Phase 2)', () => {
  const BASE_CALLER_CONTENT =
    'import { Controller, Get } from "@nestjs/common";\n' +
    '\n' +
    '@Controller("widgets")\n' +
    'export class WidgetsController {\n' +
    '  @Get()\n' +
    '  list() {\n' +
    '    return [];\n' +
    '  }\n' +
    '}';

  const MODIFIED_CALLER_PATCH =
    '@@ -1,9 +1,10 @@\n' +
    ' import { Controller, Get } from "@nestjs/common";\n' +
    '+import { getAuthenticatedUserId } from "../auth/get-authenticated-user-id";\n' +
    ' \n' +
    ' @Controller("widgets")\n' +
    ' export class WidgetsController {\n' +
    '   @Get()\n' +
    '-  list() {\n' +
    '-    return [];\n' +
    '+  list(@Request() request) {\n' +
    '+    return getAuthenticatedUserId(request);\n' +
    '   }\n' +
    ' }';

  it('finds a new call site added only within this PR\'s own modified-file diff', async () => {
    const svc = buildService(
      {
        getSymbolRows: async (_repoId, paths) =>
          paths.includes('widgets.controller.ts')
            ? [
                { path: 'widgets.controller.ts', name: 'list', kind: 'method', line: 6, endLine: 8, exported: true, signature: null },
              ]
            : [],
        getResolvedCallers: async () => [], // main never called getAuthenticatedUserId — nothing persisted
      },
      async (_ref, path) => {
        if (path === 'widgets.controller.ts') return BASE_CALLER_CONTENT;
        throw new Error(`unexpected readFile: ${path}`);
      },
    );

    const result = await getBlastRadius(svc, 'r1', ['auth/get-authenticated-user-id.ts', 'widgets.controller.ts'], {
      'auth/get-authenticated-user-id.ts': ADDED_FILE_PATCH,
      'widgets.controller.ts': MODIFIED_CALLER_PATCH,
    });

    expect(result.changedSymbols.map((s) => s.name)).toContain('getAuthenticatedUserId');
    const callers = result.callers.filter((c) => c.viaSymbol === 'getAuthenticatedUserId');
    expect(callers).toHaveLength(1);
    expect(callers[0]!.file).toBe('widgets.controller.ts');
    expect(callers[0]!.symbol).toBe('list');
    expect(callers[0]!.rank).toBe(0);
  });

  it('skips Phase 2 cleanly when the base content has diverged from the patch (readFile mismatch)', async () => {
    const svc = buildService(
      {
        getSymbolRows: async (_repoId, paths) =>
          paths.includes('widgets.controller.ts')
            ? [
                { path: 'widgets.controller.ts', name: 'list', kind: 'method', line: 6, endLine: 8, exported: true, signature: null },
              ]
            : [],
        getResolvedCallers: async () => [],
      },
      async () => 'totally different content that will never match the patch context lines',
    );

    const result = await getBlastRadius(svc, 'r1', ['auth/get-authenticated-user-id.ts', 'widgets.controller.ts'], {
      'auth/get-authenticated-user-id.ts': ADDED_FILE_PATCH,
      'widgets.controller.ts': MODIFIED_CALLER_PATCH,
    });

    // Symbol still visible (Phase 1 unaffected), but no caller found (Phase 2 degraded, not crashed).
    expect(result.changedSymbols.map((s) => s.name)).toContain('getAuthenticatedUserId');
    expect(result.callers.filter((c) => c.viaSymbol === 'getAuthenticatedUserId')).toHaveLength(0);
    expect(result.degraded).toBe(false);
  });
});
