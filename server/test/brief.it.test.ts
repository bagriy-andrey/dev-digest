/**
 * PR Why + Risk Brief (SPEC-02) — real-Postgres integration tests.
 *
 * NOTE (per `server/insights.md`'s Tool & Library Notes): `testcontainers`
 * cannot start a Postgres container in this sandbox (Rancher Desktop / k3s
 * daemon isn't a strategy testcontainers auto-detects) — this file is
 * written and typechecked, but `dockerAvailable()` gates every suite behind
 * `describe.skip` here, exactly like every other pre-existing `.it.test.ts`
 * (`onboarding.it.test.ts`, `smart-diff.it.test.ts`, `blast.it.test.ts`).
 * Don't treat "0 tests ran" for this file as a regression; it was verified
 * by close reading + `test/brief.test.ts` (hermetic) instead.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockLLMProvider } from '../src/adapters/mocks.js';
import type { Brief } from '@devdigest/shared';
import type { GitHubClient } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[brief] Docker not available — skipping integration tests.');
}

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const VALID_BRIEF: Brief = {
  what: 'Adds rate limiting to public API endpoints',
  why: 'Prevents abuse of unauthenticated endpoints',
  risk_level: 'medium',
  risks: [
    {
      kind: 'reliability',
      title: 'New middleware ordering',
      explanation: 'rate limiter runs before auth',
      severity: 'medium',
      file_refs: ['src/middleware/ratelimit.ts'],
    },
  ],
  review_focus: [{ file: 'src/middleware/ratelimit.ts', reason: 'core rate-limit logic' }],
};

let repoSeq = 0;
async function setupRepoAndPr(db: PgFixture['handle']['db'], workspaceId: string) {
  const name = `brief-${repoSeq++}`;
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
      body: 'Adds a token-bucket rate limiter.',
    })
    .returning();
  await db.insert(t.prFiles).values([
    { prId: pr!.id, path: 'src/middleware/ratelimit.ts', additions: 84, deletions: 0, patch: null },
  ]);
  return { repo: repo!, pr: pr! };
}

/** GitHub adapter stub whose `getPullRequest` always throws — exercises the
 *  AC-3 best-effort degrade path deterministically (mirrors the real mock
 *  adapter's `linked_issue: null` behavior at the "even offline" extreme). */
const FAILING_GITHUB: GitHubClient = {
  listPullRequests: async () => [],
  getPullRequest: async () => {
    throw new Error('offline / no GITHUB_TOKEN');
  },
  postReview: async () => ({ id: '1' }),
  listReviewComments: async () => [],
  createReviewComment: async () => {
    throw new Error('not used');
  },
  openPullRequest: async () => ({ url: '' }),
  commitFiles: async () => ({ branch: '' }),
  findOpenPr: async () => null,
  getIssue: async () => {
    throw new Error('not used');
  },
  currentLogin: async () => 'test-user',
} as unknown as GitHubClient;

d('brief (Testcontainers pg)', () => {
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

  function appWith(opts: { llm?: MockLLMProvider; github?: GitHubClient } = {}) {
    return buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        ...(opts.llm ? { llm: { openrouter: opts.llm } } : {}),
        ...(opts.github ? { github: opts.github } : {}),
      },
    });
  }

  it('GET returns null (never generates) before any POST — AC-13', async () => {
    const app = await appWith();
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/brief` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toBeNull();

    await app.close();
  });

  it('POST generates and upserts a pr_brief row (AC-11), no linked issue / no specs still succeed (AC-3/AC-4)', async () => {
    const llm = new MockLLMProvider('openai', { structured: VALID_BRIEF });
    const app = await appWith({ llm, github: FAILING_GITHUB });
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    const res = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/brief` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Brief;
    expect(body.what).toBe(VALID_BRIEF.what);
    expect(body.review_focus).toEqual(VALID_BRIEF.review_focus); // real path, kept by grounding

    const rows = await pg.handle.db.select().from(t.prBrief).where(eq(t.prBrief.prId, pr.id));
    expect(rows).toHaveLength(1);
    expect((rows[0]!.json as Brief).what).toBe(VALID_BRIEF.what);

    const getRes = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/brief` });
    expect(getRes.statusCode).toBe(200);
    expect(getRes.json()).toEqual(body);

    await app.close();
  });

  it('a second generate overwrites the same pr_id row rather than appending (AC-11/AC-12)', async () => {
    const llm = new MockLLMProvider('openai', { structured: VALID_BRIEF });
    const app = await appWith({ llm, github: FAILING_GITHUB });
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    await app.inject({ method: 'POST', url: `/pulls/${pr.id}/brief` });
    await app.inject({ method: 'POST', url: `/pulls/${pr.id}/brief` });

    const rows = await pg.handle.db.select().from(t.prBrief).where(eq(t.prBrief.prId, pr.id));
    expect(rows).toHaveLength(1);

    await app.close();
  });

  it('an LLM failure leaves any prior cached brief untouched (AC-8)', async () => {
    const goodLlm = new MockLLMProvider('openai', { structured: VALID_BRIEF });
    let app = await appWith({ llm: goodLlm, github: FAILING_GITHUB });
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    const first = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/brief` });
    expect(first.statusCode).toBe(200);
    const priorBody = first.json();
    await app.close();

    const brokenLlm = new MockLLMProvider('openai', { structured: VALID_BRIEF });
    brokenLlm.completeStructured = async () => {
      throw new Error('provider unavailable');
    };
    app = await appWith({ llm: brokenLlm, github: FAILING_GITHUB });

    const second = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/brief` });
    expect(second.statusCode).toBeGreaterThanOrEqual(400);

    const after = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/brief` });
    expect(after.json()).toEqual(priorBody);

    await app.close();
  });

  it('404s for a PR id that does not belong to the caller\'s workspace', async () => {
    const app = await appWith();
    const [otherWs] = await pg.handle.db.insert(t.workspaces).values({ name: 'other-workspace' }).returning();
    const { pr } = await setupRepoAndPr(pg.handle.db, otherWs!.id);

    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/brief` });
    expect(res.statusCode).toBe(404);

    await app.close();
  });
});

/**
 * AC-13 (rate-limit): a per-route `config.rateLimit` object is UNOBSERVABLE
 * behaviorally in `.it.test.ts` — `@fastify/rate-limit` is only registered
 * when `config.nodeEnv !== 'test'` (`src/app.ts`), so under `NODE_ENV=test`
 * the config is inert JSON: no header, no 429, ever (server insights). This
 * is a source-level assertion instead, run unconditionally (no Docker/DB
 * needed) — reads the route file and regexes the block right after the
 * POST route's URL literal for the `rateLimit:` config.
 */
describe('POST /pulls/:id/brief rate-limit config (source-read, AC-13)', () => {
  it('declares { max: 10, timeWindow: "1 minute" } on the POST route', () => {
    const routesPath = fileURLToPath(new URL('../src/modules/brief/routes.ts', import.meta.url));
    const source = readFileSync(routesPath, 'utf8');
    const postBlockStart = source.indexOf("'/pulls/:id/brief'", source.indexOf('app.post'));
    expect(postBlockStart).toBeGreaterThan(-1);
    const block = source.slice(postBlockStart, postBlockStart + 400);
    expect(block).toMatch(/rateLimit:\s*\{\s*max:\s*10,\s*timeWindow:\s*'1 minute'\s*\}/);
  });
});
