/**
 * Eval cases (SPEC-03 step 4) — CRUD + create-from-finding (AC-2..10, AC-25).
 * Real Postgres via testcontainers. See `server/insights.md` if this suite
 * can't start a container in your sandbox (a documented environment
 * limitation, not a code regression) — write/typecheck this file and verify
 * by close reading regardless.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { waitForPrRuns } from './helpers/runs.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockLLMProvider, MockEmbedder, MockGitClient } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import type { Review } from '@devdigest/shared';
import type { FastifyInstance } from 'fastify';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[evals-cases] Docker not available — skipping integration tests.');
}

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const DIFF = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -10,3 +10,4 @@
   port: 3000,
+  stripeKey: "sk_live_xxx",
   redisUrl: x,`;

/** A Review fixture: exactly one grounded finding on the real diff line. */
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
      confidence: 0.95,
      kind: 'finding',
    },
  ],
};

let repoSeq = 0;
async function setupRepoAndPr(db: PgFixture['handle']['db'], workspaceId: string) {
  const name = `evals-cases-repo-${repoSeq++}`;
  const [repo] = await db
    .insert(t.repos)
    .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
    .returning();
  const [pr] = await db
    .insert(t.pullRequests)
    .values({
      workspaceId,
      repoId: repo!.id,
      number: 482,
      title: 'Add rate limiting',
      author: 'marisa.koch',
      branch: 'feat/rl',
      base: 'main',
      headSha: 'a1b2c3d4',
      additions: 1,
      deletions: 0,
      filesCount: 1,
      status: 'needs_review',
      body: 'Add rate limiting. Closes #471.',
    })
    .returning();
  await db.insert(t.prFiles).values({
    prId: pr!.id,
    path: 'src/config.ts',
    additions: 1,
    deletions: 0,
    patch: '@@ -10,3 +10,4 @@\n   port: 3000,\n+  stripeKey: "sk_live_xxx",\n   redisUrl: x,',
  });
  return { repo: repo!, pr: pr! };
}

d('Eval cases (SPEC-03 step 4)', () => {
  let pg: PgFixture;
  let workspaceId: string;

  beforeAll(async () => {
    pg = await startPg();
    const seeded = await seed(pg.handle.db);
    workspaceId = seeded.workspaceId;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  function appWith(structured: unknown) {
    return buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        git: new MockGitClient({ diff: DIFF }),
        llm: { openai: new MockLLMProvider('openai', { structured }) },
      },
    });
  }

  /** Create an agent, a PR, run one review, wait for it, return the finding id. */
  async function seedReviewedFinding(app: FastifyInstance) {
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'Sec Reviewer', provider: 'openai', model: 'gpt-4.1', system_prompt: 'sec' },
      })
    ).json();
    await app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { agentId: agent.id } });
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });
    const reviews = (await app.inject({ method: 'GET', url: `/pulls/${pr.id}/reviews` })).json();
    const findingId = reviews[0].findings[0].id as string;
    return { agent, pr, findingId };
  }

  it('an undecided finding is rejected with 422 naming the missing decision (AC-2)', async () => {
    const app = await appWith(REVIEW_FIXTURE);
    const { findingId } = await seedReviewedFinding(app);

    const res = await app.inject({ method: 'POST', url: `/findings/${findingId}/eval-case` });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.message).toMatch(/decid/i);

    await app.close();
  });

  it('an accepted finding creates a must_find case, verbatim file/line, no extra input (AC-3)', async () => {
    const app = await appWith(REVIEW_FIXTURE);
    const { agent, findingId } = await seedReviewedFinding(app);
    await app.inject({ method: 'POST', url: `/findings/${findingId}/accept` });

    const res = await app.inject({ method: 'POST', url: `/findings/${findingId}/eval-case` });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.owner_kind).toBe('agent');
    expect(body.owner_id).toBe(agent.id);
    expect(body.expected_output).toEqual([
      {
        kind: 'must_find',
        file: 'src/config.ts',
        start_line: 11,
        end_line: 11,
        severity: 'CRITICAL',
        category: 'security',
        title: 'Hardcoded Stripe secret key',
      },
    ]);

    await app.close();
  });

  it('a dismissed finding creates an IDENTICAL case except must_not_flag (AC-4)', async () => {
    const app = await appWith(REVIEW_FIXTURE);
    const { findingId } = await seedReviewedFinding(app);
    await app.inject({ method: 'POST', url: `/findings/${findingId}/dismiss` });

    const res = await app.inject({ method: 'POST', url: `/findings/${findingId}/eval-case` });
    expect(res.statusCode).toBe(201);
    const [expectation] = res.json().expected_output;
    expect(expectation.kind).toBe('must_not_flag');
    expect(expectation.file).toBe('src/config.ts');
    expect(expectation.start_line).toBe(11);
    expect(expectation.end_line).toBe(11);

    await app.close();
  });

  it('persists input_diff/input_files/input_meta with finding_id, pr_id and the decision (AC-5)', async () => {
    const app = await appWith(REVIEW_FIXTURE);
    const { pr, findingId } = await seedReviewedFinding(app);
    await app.inject({ method: 'POST', url: `/findings/${findingId}/accept` });

    const res = await app.inject({ method: 'POST', url: `/findings/${findingId}/eval-case` });
    const body = res.json();

    expect(body.input_diff).toContain('stripeKey');
    expect(body.input_files).toEqual([{ path: 'src/config.ts', additions: 1, deletions: 0 }]);
    expect(body.input_meta.finding_id).toBe(findingId);
    expect(body.input_meta.pr_id).toBe(pr.id);
    expect(body.input_meta.decision).toBe('accepted');
    expect(body.input_meta.pr_number).toBe(482);

    await app.close();
  });

  it('a second POST for the same finding is idempotent — returns the SAME case id, 200 not 201 (AC-6)', async () => {
    const app = await appWith(REVIEW_FIXTURE);
    const { findingId } = await seedReviewedFinding(app);
    await app.inject({ method: 'POST', url: `/findings/${findingId}/accept` });

    const first = await app.inject({ method: 'POST', url: `/findings/${findingId}/eval-case` });
    expect(first.statusCode).toBe(201);
    const second = await app.inject({ method: 'POST', url: `/findings/${findingId}/eval-case` });
    expect(second.statusCode).toBe(200);
    expect(second.json().id).toBe(first.json().id);

    const rows = await pg.handle.db
      .select()
      .from(t.evalCases)
      .where(eq(t.evalCases.id, first.json().id));
    expect(rows).toHaveLength(1);

    await app.close();
  });

  it("the finding's review has no owning agent ⇒ 409, zero rows written (AC-7)", async () => {
    const app = await appWith(REVIEW_FIXTURE);
    const { findingId } = await seedReviewedFinding(app);
    await app.inject({ method: 'POST', url: `/findings/${findingId}/accept` });

    const [finding] = await pg.handle.db.select().from(t.findings).where(eq(t.findings.id, findingId));
    // Simulate "the owning agent was deleted" (edge case 11): reviews.agent_id
    // has no FK constraint, so agent_runs/reviews keep history with it null.
    await pg.handle.db.update(t.reviews).set({ agentId: null }).where(eq(t.reviews.id, finding!.reviewId));

    const before = await pg.handle.db.select().from(t.evalCases);
    const res = await app.inject({ method: 'POST', url: `/findings/${findingId}/eval-case` });
    expect(res.statusCode).toBe(409);
    const after = await pg.handle.db.select().from(t.evalCases);
    expect(after.length).toBe(before.length);

    await app.close();
  });

  it('invalid expected_output on save is rejected with 400 naming the first invalid entry, row unchanged (AC-8)', async () => {
    const app = await appWith(REVIEW_FIXTURE);
    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'CRUD Agent', provider: 'openai', model: 'gpt-4.1', system_prompt: 'x' },
      })
    ).json();

    const created = await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/eval-cases`,
      payload: {
        owner_kind: 'agent',
        owner_id: agent.id,
        name: 'Hand-authored case',
        input_diff: DIFF,
        expected_output: [{ kind: 'must_find', file: 'src/config.ts', start_line: 11 }],
      },
    });
    expect(created.statusCode).toBe(201);
    const caseId = created.json().id;

    // Missing required `file` on the (only) entry — must 400, not 422.
    const badUpdate = await app.inject({
      method: 'PUT',
      url: `/eval-cases/${caseId}`,
      payload: {
        owner_kind: 'agent',
        owner_id: agent.id,
        name: 'Hand-authored case',
        input_diff: DIFF,
        expected_output: [{ kind: 'must_find', start_line: 11 }],
      },
    });
    expect(badUpdate.statusCode).toBe(400);
    expect(badUpdate.json().error.message).toMatch(/index 0/);

    const stillThere = await app.inject({ method: 'GET', url: `/agents/${agent.id}/eval-cases` });
    expect(stillThere.json()[0].expected_output).toEqual([
      { kind: 'must_find', file: 'src/config.ts', start_line: 11 },
    ]);

    await app.close();
  });

  it('full CRUD; deleting a case cascades to its eval_runs (AC-9)', async () => {
    const app = await appWith(REVIEW_FIXTURE);
    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'CRUD2', provider: 'openai', model: 'gpt-4.1', system_prompt: 'x' },
      })
    ).json();

    const created = await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/eval-cases`,
      payload: {
        owner_kind: 'agent',
        owner_id: agent.id,
        name: 'Original name',
        input_diff: DIFF,
        expected_output: [],
      },
    });
    expect(created.statusCode).toBe(201);
    const caseId = created.json().id;

    const listed = await app.inject({ method: 'GET', url: `/agents/${agent.id}/eval-cases` });
    expect(listed.json().some((c: { id: string }) => c.id === caseId)).toBe(true);

    const updated = await app.inject({
      method: 'PUT',
      url: `/eval-cases/${caseId}`,
      payload: {
        owner_kind: 'agent',
        owner_id: agent.id,
        name: 'Renamed',
        input_diff: DIFF,
        expected_output: [],
      },
    });
    expect(updated.json().name).toBe('Renamed');

    // A run row exists for this case — deletion must cascade to it.
    await pg.handle.db.insert(t.evalRuns).values({ caseId, pass: true });
    const runsBefore = await pg.handle.db.select().from(t.evalRuns).where(eq(t.evalRuns.caseId, caseId));
    expect(runsBefore).toHaveLength(1);

    const deleted = await app.inject({ method: 'DELETE', url: `/eval-cases/${caseId}` });
    expect(deleted.json()).toEqual({ ok: true });

    const runsAfter = await pg.handle.db.select().from(t.evalRuns).where(eq(t.evalRuns.caseId, caseId));
    expect(runsAfter).toHaveLength(0);

    await app.close();
  });

  it('an agent with 8+ cases returns ALL of them, no pagination/truncation (AC-10)', async () => {
    const app = await appWith(REVIEW_FIXTURE);
    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'Many Cases', provider: 'openai', model: 'gpt-4.1', system_prompt: 'x' },
      })
    ).json();

    for (let i = 0; i < 9; i++) {
      const res = await app.inject({
        method: 'POST',
        url: `/agents/${agent.id}/eval-cases`,
        payload: {
          owner_kind: 'agent',
          owner_id: agent.id,
          name: `Case ${i}`,
          input_diff: DIFF,
          expected_output: [],
        },
      });
      expect(res.statusCode).toBe(201);
    }

    const list = await app.inject({ method: 'GET', url: `/agents/${agent.id}/eval-cases` });
    expect(list.json()).toHaveLength(9);

    await app.close();
  });

  it("reversing the decision later leaves the case's expectation kind UNCHANGED (AC-25)", async () => {
    const app = await appWith(REVIEW_FIXTURE);
    const { findingId } = await seedReviewedFinding(app);
    await app.inject({ method: 'POST', url: `/findings/${findingId}/accept` });

    const created = await app.inject({ method: 'POST', url: `/findings/${findingId}/eval-case` });
    expect(created.json().expected_output[0].kind).toBe('must_find');

    // The user reverses their decision — the ALREADY-CREATED case must not change.
    await app.inject({ method: 'POST', url: `/findings/${findingId}/dismiss` });

    const stillCreated = await pg.handle.db
      .select()
      .from(t.evalCases)
      .where(eq(t.evalCases.id, created.json().id));
    expect((stillCreated[0]!.expectedOutput as { kind: string }[])[0]!.kind).toBe('must_find');

    await app.close();
  });
});
