import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockLLMProvider } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import type { Review } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

/**
 * Working-tree diff touching src/config.ts (line 11 added) — mirrors
 * reviews.it.test.ts's DIFF fixture so `parseUnifiedDiff` recognizes it.
 */
const DIFF = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -10,3 +10,4 @@
   port: 3000,
+  stripeKey: "sk_live_xxx",
   redisUrl: x,`;

/** A single grounded CRITICAL finding (line 11 is inside the diff's hunk). */
const REVIEW_FIXTURE: Review = {
  verdict: 'request_changes',
  summary: 'Hardcoded Stripe secret introduced.',
  score: 42,
  findings: [
    {
      id: 'f-valid',
      severity: 'CRITICAL',
      category: 'security',
      title: 'Hardcoded Stripe secret key',
      file: 'src/config.ts',
      start_line: 11,
      end_line: 11,
      rationale: 'A live Stripe key is committed in source.',
      suggestion: 'Move the key to an environment variable.',
      confidence: 0.95,
      kind: 'finding',
    },
  ],
};

let repoSeq = 0;
async function setupRepo(db: PgFixture['handle']['db'], workspaceId: string) {
  const name = `review-diff-${repoSeq++}`;
  const [repo] = await db
    .insert(t.repos)
    .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
    .returning();
  return repo!;
}

d('review-diff (Testcontainers pg)', () => {
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

  // The seed's built-in agents all use `openrouter` (`DEFAULT_PROVIDER` in
  // src/db/seed.ts) — mirrors the same override key used in blast.it.test.ts.
  function appWith(structured: unknown) {
    return buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { llm: { openrouter: new MockLLMProvider('openai', { structured }) } },
    });
  }

  async function tableCounts() {
    const [runs, reviews, findings] = await Promise.all([
      pg.handle.db.select().from(t.agentRuns),
      pg.handle.db.select().from(t.reviews),
      pg.handle.db.select().from(t.findings),
    ]);
    return { runs: runs.length, reviews: reviews.length, findings: findings.length };
  }

  it('returns one AgentReviewResult per enabled agent; blockers reflect countBlockers under ciFailOn', async () => {
    const app = await appWith(REVIEW_FIXTURE);
    const repo = await setupRepo(pg.handle.db, workspaceId);

    const res = await app.inject({
      method: 'POST',
      url: `/repos/${repo.id}/review-diff`,
      payload: { diff: DIFF },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    // The seed's built-in agents are all enabled (5 as of this session) — assert
    // "at least the seed's enabled agents", not an exact count, so the test
    // doesn't break when the seed roster grows.
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThanOrEqual(2);

    for (const result of body) {
      expect(result.agent).toMatchObject({ id: expect.any(String), name: expect.any(String) });
      expect(result.verdict).toBe('request_changes');
      expect(typeof result.score).toBe('number');
      expect(Array.isArray(result.findings)).toBe(true);
      expect(result.findings).toHaveLength(1);
      expect(result.findings[0].file).toBe('src/config.ts');
      expect(result.findings[0].start_line).toBe(11);
      // Default agent.ciFailOn is 'critical' (schema default); the single kept
      // finding is CRITICAL, so countBlockers should gate on it.
      expect(result.blockers).toBe(1);
    }

    await app.close();
  });

  it('persists nothing: agent_runs/reviews/findings counts are unchanged after the call', async () => {
    const app = await appWith(REVIEW_FIXTURE);
    const repo = await setupRepo(pg.handle.db, workspaceId);

    const before = await tableCounts();
    const res = await app.inject({
      method: 'POST',
      url: `/repos/${repo.id}/review-diff`,
      payload: { diff: DIFF },
    });
    expect(res.statusCode).toBe(200);
    const after = await tableCounts();
    expect(after).toEqual(before);

    await app.close();
  });

  it("404s for a repoId outside the caller's workspace", async () => {
    const app = await appWith(REVIEW_FIXTURE);
    const [otherWs] = await pg.handle.db
      .insert(t.workspaces)
      .values({ name: 'other-workspace-review-diff' })
      .returning();
    const otherRepo = await setupRepo(pg.handle.db, otherWs!.id);

    const res = await app.inject({
      method: 'POST',
      url: `/repos/${otherRepo.id}/review-diff`,
      payload: { diff: DIFF },
    });
    expect(res.statusCode).toBe(404);

    await app.close();
  });

  it('400s for a whitespace-only diff (belt-and-suspenders past the schema\'s min(1))', async () => {
    const app = await appWith(REVIEW_FIXTURE);
    const repo = await setupRepo(pg.handle.db, workspaceId);

    const res = await app.inject({
      method: 'POST',
      url: `/repos/${repo.id}/review-diff`,
      payload: { diff: '   \n\t  ' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('empty_diff');

    await app.close();
  });

  it('400s when the workspace has zero enabled agents', async () => {
    const app = await appWith(REVIEW_FIXTURE);
    const repo = await setupRepo(pg.handle.db, workspaceId);

    // Temporarily disable every seeded agent in the default workspace, then
    // restore — the workspace/agents are shared across this whole file.
    await pg.handle.db.update(t.agents).set({ enabled: false }).where(eq(t.agents.workspaceId, workspaceId));
    try {
      const res = await app.inject({
        method: 'POST',
        url: `/repos/${repo.id}/review-diff`,
        payload: { diff: DIFF },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('no_enabled_agents');
    } finally {
      await pg.handle.db.update(t.agents).set({ enabled: true }).where(eq(t.agents.workspaceId, workspaceId));
    }

    await app.close();
  });

  it('400s for a non-empty but unparseable diff', async () => {
    const app = await appWith(REVIEW_FIXTURE);
    const repo = await setupRepo(pg.handle.db, workspaceId);

    const res = await app.inject({
      method: 'POST',
      url: `/repos/${repo.id}/review-diff`,
      payload: { diff: 'this is not a real diff, just plain text with no hunks.' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('unparseable_diff');

    await app.close();
  });
});

// Rate-limit config is inert under NODE_ENV=test (the global @fastify/rate-limit
// plugin is not registered — see src/app.ts) and Fastify does not expose a
// per-route `config` object through its public introspection API (`findRoute`
// explicitly omits `store`), so there is no way to observe the route's rate
// limit behaviourally in-process. This test instead pins the source-level
// route config, matching `POST /pulls/:id/review`'s 10/min exactly. Doesn't
// touch Postgres, so it runs regardless of Docker availability.
it("POST /repos/:id/review-diff is rate-limited 10/min, mirroring POST /pulls/:id/review", () => {
  const src = readFileSync(new URL('../src/modules/reviews/routes.ts', import.meta.url), 'utf-8');
  const routeBlock = src.slice(src.indexOf("'/repos/:id/review-diff'"));
  expect(routeBlock).toMatch(/rateLimit:\s*{\s*max:\s*10,\s*timeWindow:\s*'1 minute'\s*}/);
});
