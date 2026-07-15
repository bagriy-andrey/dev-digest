/**
 * Onboarding generator (SPEC-01 onboarding-generator) — real-Postgres
 * integration tests.
 *
 * NOTE (per `server/insights.md`'s Tool & Library Notes): `testcontainers`
 * cannot start a Postgres container in this sandbox (Rancher Desktop / k3s
 * daemon isn't a strategy testcontainers auto-detects) — this file is written
 * and typechecked, but `dockerAvailable()` gates every suite behind
 * `describe.skip` here, exactly like every other pre-existing `.it.test.ts`.
 * Don't debug a "0 tests ran" result for this file as a regression; it was
 * verified by close reading + `test/onboarding.test.ts` (hermetic) instead.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockLLMProvider } from '../src/adapters/mocks.js';
import { DEGRADED_SECTION_BODY } from '../src/modules/onboarding/constants.js';
import type { RepoIntel } from '../src/modules/repo-intel/types.js';
import type { OnboardingSection } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[onboarding] Docker not available — skipping integration tests.');
}

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const VALID_FIXTURE: { sections: OnboardingSection[] } = {
  sections: [
    { kind: 'tech_stack', title: 'Stack', body: 'Node + TypeScript, per package.json', diagram: null, links: [] },
    { kind: 'architecture', title: 'Arch', body: 'Layered service', diagram: 'flowchart TD\nA-->B', links: [] },
    { kind: 'routes_and_apis', title: 'Routes', body: 'GET /health', diagram: null, links: [] },
    { kind: 'reading_path', title: 'Path', body: 'Start at src/index.ts', diagram: null, links: [] },
    { kind: 'first_tasks', title: 'Tasks', body: 'Read the README first', diagram: null, links: [] },
  ],
};

let repoSeq = 0;
async function makeRepo(db: PgFixture['handle']['db'], workspaceId: string, clonePath: string | null) {
  const name = `onboarding-${repoSeq++}`;
  const [repo] = await db
    .insert(t.repos)
    .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}`, clonePath })
    .returning();
  return repo!;
}

/** `RepoIntel` spy: everything degrades to fixed, cheap values; `indexRepo`/`refreshIndex`
 *  are counted so AC-13 ("regenerate never triggers a reindex") can be asserted directly. */
function makeRepoIntelSpy(overrides: Partial<Record<keyof RepoIntel, unknown>> = {}) {
  const calls = { indexRepo: 0, refreshIndex: 0 };
  const repoIntel: RepoIntel = {
    indexRepo: async () => {
      calls.indexRepo++;
      return { status: 'full', filesIndexed: 0, filesSkipped: 0, durationMs: 0 };
    },
    refreshIndex: async () => {
      calls.refreshIndex++;
      return { status: 'full', filesIndexed: 0, filesSkipped: 0, durationMs: 0 };
    },
    getIndexState: async () => ({
      repoId: 'x',
      lastIndexedSha: 'sha-it-1',
      status: 'full',
      filesIndexed: 5,
      filesSkipped: 0,
      durationMs: 1,
      indexerVersion: 1,
      updatedAt: new Date(),
      degraded: false,
    }),
    getBlastRadius: async () => ({ changedSymbols: [], callers: [], impactedEndpoints: [], degraded: true }),
    getRepoMap: async () => ({ text: 'src/index.ts\n', tokens: 5, cached: true }),
    getFileRank: async () => [],
    getSymbolsInFiles: async () => [],
    getCallerSignatures: async () => [],
    getUnresolvedReferences: async () => [],
    getConventionSamples: async () => [],
    getTopFilesByRank: async () => ['src/index.ts'],
    getCriticalPaths: async () => [],
    getRepoEndpoints: async () => ['GET /health'],
    ...overrides,
  } as RepoIntel;
  return { repoIntel, calls };
}

d('Onboarding generator (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let cloneDir: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
    cloneDir = await mkdtemp(join(tmpdir(), 'onboarding-it-'));
    await writeFile(join(cloneDir, 'package.json'), '{"name":"demo"}');
  });
  afterAll(async () => {
    await pg?.stop();
    await rm(cloneDir, { recursive: true, force: true });
  });

  function appWith(opts: { llm?: MockLLMProvider; repoIntel?: RepoIntel }) {
    return buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        ...(opts.llm ? { llm: { openrouter: opts.llm } } : {}),
        ...(opts.repoIntel ? { repoIntel: opts.repoIntel } : {}),
      },
    });
  }

  it('AC-5: an un-indexed repo still generates Tech Stack from the manifest, and degrades Architecture/Routes/Reading Path', async () => {
    const llm = new MockLLMProvider('openai', { structured: VALID_FIXTURE });
    const app = await appWith({ llm }); // no repoIntel override — real facade, no index rows → degraded
    const repo = await makeRepo(pg.handle.db, workspaceId, cloneDir);

    const res = await app.inject({ method: 'POST', url: `/repos/${repo.id}/onboarding/generate` });
    expect(res.statusCode).toBe(200);
    const doc = res.json() as { onboarding: { sections: OnboardingSection[] } };
    const byKind = new Map(doc.onboarding.sections.map((s) => [s.kind, s]));

    expect(byKind.get('tech_stack')?.body).toContain('Node + TypeScript');
    expect(byKind.get('architecture')?.body).toBe(DEGRADED_SECTION_BODY);
    expect(byKind.get('routes_and_apis')?.body).toBe(DEGRADED_SECTION_BODY);
    expect(byKind.get('reading_path')?.body).toBe(DEGRADED_SECTION_BODY);
    await app.close();
  });

  it('AC-10: an LLM failure leaves the prior persisted document untouched and reports the failure reason', async () => {
    const goodLlm = new MockLLMProvider('openai', { structured: VALID_FIXTURE });
    let app = await appWith({ llm: goodLlm });
    const repo = await makeRepo(pg.handle.db, workspaceId, cloneDir);

    const first = await app.inject({ method: 'POST', url: `/repos/${repo.id}/onboarding/generate` });
    expect(first.statusCode).toBe(200);
    const priorDoc = first.json();
    await app.close();

    const brokenLlm = new MockLLMProvider('openai', { structured: VALID_FIXTURE });
    brokenLlm.completeStructured = async () => {
      throw new Error('provider unavailable');
    };
    app = await appWith({ llm: brokenLlm });

    const second = await app.inject({ method: 'POST', url: `/repos/${repo.id}/onboarding/generate` });
    expect(second.statusCode).toBeGreaterThanOrEqual(400);

    const after = await app.inject({ method: 'GET', url: `/repos/${repo.id}/onboarding` });
    expect(after.json()).toEqual(priorDoc); // unchanged
    await app.close();
  });

  it('AC-12: Regenerate overwrites the single row per repo rather than appending', async () => {
    const llm = new MockLLMProvider('openai', { structured: VALID_FIXTURE });
    const app = await appWith({ llm });
    const repo = await makeRepo(pg.handle.db, workspaceId, cloneDir);

    await app.inject({ method: 'POST', url: `/repos/${repo.id}/onboarding/generate` });
    await app.inject({ method: 'POST', url: `/repos/${repo.id}/onboarding/generate` });

    const rows = await pg.handle.db.select().from(t.onboarding).where(eq(t.onboarding.repoId, repo.id));
    expect(rows).toHaveLength(1);
    await app.close();
  });

  it('AC-13: Regenerate reads the current index without triggering a reindex/resync', async () => {
    const llm = new MockLLMProvider('openai', { structured: VALID_FIXTURE });
    const { repoIntel, calls } = makeRepoIntelSpy();
    const app = await appWith({ llm, repoIntel });
    const repo = await makeRepo(pg.handle.db, workspaceId, cloneDir);

    const res = await app.inject({ method: 'POST', url: `/repos/${repo.id}/onboarding/generate` });
    expect(res.statusCode).toBe(200);
    expect(calls.indexRepo).toBe(0);
    expect(calls.refreshIndex).toBe(0);
    await app.close();
  });

  it('GET /repos/:id/onboarding returns the null doc (never a 404) for a repo with no generation yet', async () => {
    const app = await appWith({});
    const repo = await makeRepo(pg.handle.db, workspaceId, cloneDir);

    const res = await app.inject({ method: 'GET', url: `/repos/${repo.id}/onboarding` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ onboarding: null, source_sha: null, generated_at: null });
    await app.close();
  });
});
