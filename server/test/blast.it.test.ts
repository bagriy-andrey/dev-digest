import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockLLMProvider } from '../src/adapters/mocks.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

let repoSeq = 0;
async function setupRepoAndPr(db: PgFixture['handle']['db'], workspaceId: string) {
  const name = `blast-${repoSeq++}`;
  const [repo] = await db
    .insert(t.repos)
    .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
    .returning();
  const [pr] = await db
    .insert(t.pullRequests)
    .values({
      workspaceId,
      repoId: repo!.id,
      number: 1,
      title: 'Add rate limiting to public API endpoints',
      author: 'marisa.koch',
      branch: 'feat/rate-limit-public',
      base: 'main',
      headSha: 'a1b2c3d4',
      additions: 0,
      deletions: 0,
      filesCount: 0,
      status: 'needs_review',
      body: null,
    })
    .returning();
  return { repo: repo!, pr: pr! };
}

/** Add another PR to an existing repo (for prior-PRs overlap coverage), optionally
 *  seeded with `pr_files` rows. */
async function addPr(
  db: PgFixture['handle']['db'],
  workspaceId: string,
  repoId: string,
  opts: { number: number; title: string; paths?: string[] },
) {
  const [pr] = await db
    .insert(t.pullRequests)
    .values({
      workspaceId,
      repoId,
      number: opts.number,
      title: opts.title,
      author: 'other.dev',
      branch: `misc/pr-${opts.number}`,
      base: 'main',
      headSha: `sha-${opts.number}`,
      additions: 0,
      deletions: 0,
      filesCount: 0,
      status: 'needs_review',
      body: null,
    })
    .returning();
  if (opts.paths?.length) {
    await db.insert(t.prFiles).values(
      opts.paths.map((path) => ({ prId: pr!.id, path, additions: 1, deletions: 1, patch: null })),
    );
  }
  return pr!;
}

/** Seed a full repo-intel index: a changed helper, ≥2 direct callers, and a
 *  route reachable only 2 hops away (route.ts -> wrapper.ts -> changed file). */
async function seedFullIndex(db: PgFixture['handle']['db'], repoId: string) {
  await db.insert(t.repoIndexState).values({
    repoId,
    lastIndexedSha: 'sha1',
    indexerVersion: 2,
    status: 'full',
    filesIndexed: 5,
    filesSkipped: 0,
  });

  await db.insert(t.symbols).values([
    { repoId, path: 'src/rate-limit.ts', name: 'rateLimit', kind: 'function', line: 1, endLine: 5, exported: true, signature: 'function rateLimit()' },
    { repoId, path: 'src/api/index.ts', name: 'handler', kind: 'function', line: 20, endLine: 30, exported: true, signature: null },
    { repoId, path: 'src/api/webhooks.ts', name: 'webhook', kind: 'function', line: 40, endLine: 50, exported: true, signature: null },
  ]);

  await db.insert(t.references).values([
    { repoId, fromPath: 'src/api/index.ts', toSymbol: 'rateLimit', line: 23, declFile: 'src/rate-limit.ts' },
    { repoId, fromPath: 'src/api/webhooks.ts', toSymbol: 'rateLimit', line: 45, declFile: 'src/rate-limit.ts' },
  ]);

  // file_rank rows are REQUIRED — getResolvedCallers INNER JOINs file_rank on
  // (repoId, fromPath), so a caller file with no rank row silently vanishes.
  await db.insert(t.fileRank).values([
    { repoId, filePath: 'src/api/index.ts', pagerank: 1, hotness: 0, rank: 5, percentile: 80 },
    { repoId, filePath: 'src/api/webhooks.ts', pagerank: 1, hotness: 0, rank: 3, percentile: 60 },
  ]);

  // 2-hop reverse-import chain: route.ts imports wrapper.ts imports the
  // changed file. Neither is a direct caller of `rateLimit` — only reachable
  // via the file_edges walk.
  await db.insert(t.fileEdges).values([
    { repoId, fromFile: 'src/api/wrapper.ts', toFile: 'src/rate-limit.ts' },
    { repoId, fromFile: 'src/api/route.ts', toFile: 'src/api/wrapper.ts' },
  ]);

  await db.insert(t.fileFacts).values([
    { repoId, filePath: 'src/api/route.ts', endpoints: ['GET /api/items'], crons: [] },
  ]);
}

d('blast (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  function appWith() {
    return buildApp({ config: config(), db: pg.handle.db });
  }

  function appWithLlm(structured: unknown) {
    return buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { llm: { openrouter: new MockLLMProvider('openai', { structured }) } },
    });
  }

  it('returns the blast radius: direct callers + a 2-hop-only reachable endpoint', async () => {
    const app = await appWith();
    const { repo, pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    await seedFullIndex(pg.handle.db, repo.id);
    await pg.handle.db.insert(t.prFiles).values([
      { prId: pr.id, path: 'src/rate-limit.ts', additions: 12, deletions: 3, patch: null },
    ]);

    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/blast` });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.changed_symbols).toEqual([{ name: 'rateLimit', file: 'src/rate-limit.ts', kind: 'function' }]);
    expect(body.downstream).toHaveLength(1);
    const rateLimit = body.downstream[0];
    expect(rateLimit.symbol).toBe('rateLimit');

    // (b) exactly the 2 direct callers, NOT the 2-hop route.ts/wrapper.ts pair.
    expect(rateLimit.callers).toHaveLength(2);
    expect(rateLimit.callers.map((c: { file: string }) => c.file).sort()).toEqual([
      'src/api/index.ts',
      'src/api/webhooks.ts',
    ]);

    // (c) the route found only via hop 2 is still surfaced in endpoints_affected.
    expect(rateLimit.endpoints_affected).toEqual(['GET /api/items']);
    expect(rateLimit.crons_affected).toEqual([]);
    expect(body.summary).toBe('');
    expect(body.degraded).toBeUndefined();
    expect(body.prior_prs).toEqual([]);

    await app.close();
  });

  it('returns EMPTY_BLAST_RADIUS (incl. prior_prs: []) with no degraded flag for a PR with zero pr_files', async () => {
    const app = await appWith();
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/blast` });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body).toEqual({ changed_symbols: [], downstream: [], prior_prs: [], summary: '' });
    expect(body.degraded).toBeUndefined();

    await app.close();
  });

  it('prior_prs: overlapping PRs newest-first, excluding self and non-overlapping PRs', async () => {
    const app = await appWith();
    const { repo, pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    await seedFullIndex(pg.handle.db, repo.id);
    await pg.handle.db.insert(t.prFiles).values([
      { prId: pr.id, path: 'src/rate-limit.ts', additions: 12, deletions: 3, patch: null },
    ]);

    // (a) two PRs overlapping on the same changed file, seeded out of number
    // order so ORDER BY number DESC is actually exercised.
    const olderOverlap = await addPr(pg.handle.db, workspaceId, repo.id, {
      number: 2,
      title: 'Refactor rate limiter internals',
      paths: ['src/rate-limit.ts'],
    });
    const newerOverlap = await addPr(pg.handle.db, workspaceId, repo.id, {
      number: 5,
      title: 'Bump rate limiter threshold',
      paths: ['src/rate-limit.ts'],
    });
    // (b) a PR touching an unrelated file — must NOT appear.
    await addPr(pg.handle.db, workspaceId, repo.id, {
      number: 3,
      title: 'Unrelated docs update',
      paths: ['README.md'],
    });
    // A PR with zero pr_files — must NOT appear (nothing to overlap on).
    await addPr(pg.handle.db, workspaceId, repo.id, { number: 4, title: 'Empty PR' });

    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/blast` });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.prior_prs).toEqual([
      { id: newerOverlap.id, number: 5, title: 'Bump rate limiter threshold' },
      { id: olderOverlap.id, number: 2, title: 'Refactor rate limiter internals' },
    ]);

    await app.close();
  });

  it('passes through degraded/degraded_reason when the repo was never indexed', async () => {
    const app = await appWith();
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    await pg.handle.db.insert(t.prFiles).values([
      { prId: pr.id, path: 'src/unindexed.ts', additions: 1, deletions: 0, patch: null },
    ]);

    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/blast` });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.degraded).toBe(true);
    expect(typeof body.degraded_reason === 'string' || body.degraded_reason === null).toBe(true);

    await app.close();
  });

  it('POST .../summarize returns a non-empty summary, still carries prior_prs, and persists nothing (GET afterward still shows summary: "")', async () => {
    const app = await appWithLlm({ summary: 'Rate limiting now applies to two public handlers.' });
    const { repo, pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    await seedFullIndex(pg.handle.db, repo.id);
    await pg.handle.db.insert(t.prFiles).values([
      { prId: pr.id, path: 'src/rate-limit.ts', additions: 12, deletions: 3, patch: null },
    ]);
    const overlap = await addPr(pg.handle.db, workspaceId, repo.id, {
      number: 2,
      title: 'Refactor rate limiter internals',
      paths: ['src/rate-limit.ts'],
    });

    const summarizeRes = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/blast/summarize` });
    expect(summarizeRes.statusCode).toBe(200);
    const summarizeBody = summarizeRes.json();
    expect(summarizeBody.summary).toBe('Rate limiting now applies to two public handlers.');
    // The map itself is unchanged by summarizing.
    expect(summarizeBody.downstream).toHaveLength(1);
    // summarize() does not silently drop prior_prs.
    expect(summarizeBody.prior_prs).toEqual([
      { id: overlap.id, number: 2, title: 'Refactor rate limiter internals' },
    ]);

    const getRes = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/blast` });
    expect(getRes.statusCode).toBe(200);
    // Never persisted — the plain GET never calls the model, summary is '' again.
    expect(getRes.json().summary).toBe('');

    await app.close();
  });

  it('POST .../summarize on a PR with zero pr_files makes no LLM call (EMPTY_BLAST_RADIUS short-circuit)', async () => {
    const app = await appWithLlm({ summary: 'should never be used' });
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    const res = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/blast/summarize` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ changed_symbols: [], downstream: [], prior_prs: [], summary: '' });

    await app.close();
  });

  it("404s for a PR id that does not belong to the caller's workspace", async () => {
    const app = await appWith();
    const [otherWs] = await pg.handle.db.insert(t.workspaces).values({ name: 'other-workspace-blast' }).returning();
    const { pr } = await setupRepoAndPr(pg.handle.db, otherWs!.id);

    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/blast` });
    expect(res.statusCode).toBe(404);

    await app.close();
  });
});
