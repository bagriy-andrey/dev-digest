/**
 * Eval batches: running, dashboards, compare (SPEC-03 step 4 — AC-12, AC-20..23,
 * AC-24, AC-26, AC-28, AC-29, AC-33, AC-35). Real Postgres via testcontainers.
 * See `server/insights.md` if this suite can't start a container in your
 * sandbox (a documented environment limitation, not a code regression) —
 * write/typecheck this file and verify by close reading regardless.
 */
import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockLLMProvider, MockEmbedder } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import type { LLMProvider, Review, EvalRunCounts } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[evals-runs] Docker not available — skipping integration tests.');
}

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const DIFF = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -10,3 +10,4 @@
   port: 3000,
+  stripeKey: "sk_live_xxx",
   redisUrl: x,`;

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

/** Wraps a MockLLMProvider so `completeStructured` takes `delayMs` — makes a
 * batch's sequential execution observable (needed for AC-12/AC-23's timing
 * assertions, since the mock otherwise resolves near-instantly). */
function delayedProvider(inner: MockLLMProvider, delayMs: number): LLMProvider {
  return {
    id: inner.id,
    listModels: (...args: Parameters<LLMProvider['listModels']>) => inner.listModels(...args),
    complete: (...args: Parameters<LLMProvider['complete']>) => inner.complete(...args),
    completeStructured: async (...args: Parameters<LLMProvider['completeStructured']>) => {
      await new Promise((r) => setTimeout(r, delayMs));
      return inner.completeStructured(...args);
    },
    embed: (...args: Parameters<LLMProvider['embed']>) => inner.embed(...args),
  };
}

async function waitForBatchRows(
  db: PgFixture['handle']['db'],
  batchId: string,
  expectedCount: number,
  timeoutMs = 10_000,
) {
  const start = Date.now();
  for (;;) {
    const rows = await db.select().from(t.evalRuns).where(eq(t.evalRuns.batchId, batchId));
    if (rows.length >= expectedCount) return rows;
    if (Date.now() - start > timeoutMs) return rows;
    await new Promise((r) => setTimeout(r, 20));
  }
}

const ZERO_COUNTS: EvalRunCounts = { must_find: 0, matched: 0, actual: 0, noise: 0, dropped: 0 };

d('Eval batches: running, dashboards, compare (SPEC-03 step 4)', () => {
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

  function appWith(llm: LLMProvider) {
    return buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { embedder: new MockEmbedder(), llm: { openai: llm } },
    });
  }

  async function createAgent(app: Awaited<ReturnType<typeof buildApp>>, systemPrompt = 'v1 prompt') {
    const res = await app.inject({
      method: 'POST',
      url: '/agents',
      payload: { name: `Agent ${randomUUID()}`, provider: 'openai', model: 'gpt-4.1', system_prompt: systemPrompt },
    });
    return res.json();
  }

  async function createCase(
    app: Awaited<ReturnType<typeof buildApp>>,
    agentId: string,
    opts: { name?: string; inputDiff?: string; expectedOutput?: unknown } = {},
  ) {
    const res = await app.inject({
      method: 'POST',
      url: `/agents/${agentId}/eval-cases`,
      payload: {
        owner_kind: 'agent',
        owner_id: agentId,
        name: opts.name ?? `Case ${randomUUID()}`,
        input_diff: opts.inputDiff ?? DIFF,
        expected_output: opts.expectedOutput ?? [],
      },
    });
    return res.json();
  }

  /** Insert an eval_runs row DIRECTLY (bypassing the runner) so a batch's
   * agent_version/counts/cost/timestamp can be fully controlled for the
   * compare/dashboard tests. */
  async function insertRunRow(
    caseId: string,
    batchId: string,
    agentVersion: number | null,
    opts: { counts?: EvalRunCounts; pass?: boolean; cost?: number | null } = {},
  ) {
    const counts = opts.counts ?? ZERO_COUNTS;
    await pg.handle.db.insert(t.evalRuns).values({
      caseId,
      batchId,
      agentVersion,
      actualOutput: { findings: [], counts, model: null, error: null },
      pass: opts.pass ?? true,
      recall: counts.must_find === 0 ? null : counts.matched / counts.must_find,
      precision: counts.actual === 0 ? null : (counts.actual - counts.noise) / counts.actual,
      citationAccuracy:
        counts.actual + counts.dropped === 0 ? null : counts.actual / (counts.actual + counts.dropped),
      durationMs: 10,
      costUsd: opts.cost ?? null,
    });
    // Ensure strictly-increasing `ran_at` across sequential inserts (defaultNow()
    // has ms granularity — a tiny sleep keeps batch ordering deterministic).
    await new Promise((r) => setTimeout(r, 5));
  }

  it('POST returns immediately; eval_runs rows appear incrementally as the batch executes (AC-12)', async () => {
    const inner = new MockLLMProvider('openai', { structured: REVIEW_FIXTURE });
    const app = await appWith(delayedProvider(inner, 60));
    const agent = await createAgent(app);
    await createCase(app, agent.id);
    await createCase(app, agent.id);
    await createCase(app, agent.id);

    const res = await app.inject({ method: 'POST', url: `/agents/${agent.id}/eval-runs` });
    expect(res.statusCode).toBe(202);
    const { batch_id: batchId, cases_total: casesTotal } = res.json();
    expect(casesTotal).toBe(3);
    expect(batchId).not.toBeNull();

    // Immediately after the response, the (60ms-per-case, sequential) batch
    // cannot possibly have finished all 3 cases yet.
    const immediate = await pg.handle.db.select().from(t.evalRuns).where(eq(t.evalRuns.batchId, batchId));
    expect(immediate.length).toBeLessThan(3);

    const settled = await waitForBatchRows(pg.handle.db, batchId, 3);
    expect(settled).toHaveLength(3);

    await app.close();
  });

  it("a batch's status reflects whether THAT batch is running, not whether the agent has ANY batch in flight", async () => {
    // Regression test: `EvalDashboardService.buildSummary` originally computed
    // `status` via `batchRegistry.isRunning(agent.id)` — true for every batch
    // summary of that agent while ANY batch is in flight, not just the one
    // actually running. Fixed to `batchRegistry.runningBatchId(agent.id) ===
    // batchId`. Caught via manual UI testing (Agent Editor's Evals tab vs.
    // the /eval/:agentId dashboard disagreeing on whether a run was live),
    // not by this suite — this test locks the fix in.
    const inner = new MockLLMProvider('openai', { structured: REVIEW_FIXTURE });
    const app = await appWith(delayedProvider(inner, 80));
    const agent = await createAgent(app);
    const caseA = await createCase(app, agent.id);
    const caseB = await createCase(app, agent.id);

    // An already-complete, older batch inserted directly (never touches
    // batchRegistry — exactly like a batch from a past server run/restart).
    const oldBatchId = randomUUID();
    await insertRunRow(caseA.id, oldBatchId, agent.version);
    await insertRunRow(caseB.id, oldBatchId, agent.version);

    // A genuinely in-flight batch for the SAME agent (80ms/case, sequential).
    const startRes = await app.inject({ method: 'POST', url: `/agents/${agent.id}/eval-runs` });
    const { batch_id: newBatchId } = startRes.json();
    expect(newBatchId).not.toBeNull();

    // Query the dashboard WHILE the new batch is still running.
    const dashRes = await app.inject({ method: 'GET', url: `/agents/${agent.id}/eval-dashboard` });
    expect(dashRes.statusCode).toBe(200);
    const dashboard = dashRes.json() as {
      recent_batches: { batch_id: string; status: string }[];
    };
    const oldSummary = dashboard.recent_batches.find((b) => b.batch_id === oldBatchId);
    const newSummary = dashboard.recent_batches.find((b) => b.batch_id === newBatchId);
    expect(oldSummary?.status).toBe('complete');
    expect(newSummary?.status).toBe('running');

    await waitForBatchRows(pg.handle.db, newBatchId, 2);
    const dashAfter = await app.inject({ method: 'GET', url: `/agents/${agent.id}/eval-dashboard` });
    const afterSummary = (
      dashAfter.json() as { recent_batches: { batch_id: string; status: string }[] }
    ).recent_batches.find((b) => b.batch_id === newBatchId);
    expect(afterSummary?.status).toBe('complete');

    await app.close();
  });

  it('a deliberately-corrupt case among three ⇒ three rows, the corrupt one carries a readable failure reason (AC-20)', async () => {
    const app = await appWith(new MockLLMProvider('openai', { structured: REVIEW_FIXTURE }));
    const agent = await createAgent(app);
    await createCase(app, agent.id, { name: 'good 1' });
    await createCase(app, agent.id, { name: 'good 2' });
    const corrupt = await createCase(app, agent.id, { name: 'corrupt', inputDiff: '' });

    const res = await app.inject({ method: 'POST', url: `/agents/${agent.id}/eval-runs` });
    const { batch_id: batchId } = res.json();
    const rows = await waitForBatchRows(pg.handle.db, batchId, 3);
    expect(rows).toHaveLength(3);

    const failureRow = rows.find((r) => r.caseId === corrupt.id)!;
    expect(failureRow.pass).toBe(false);
    expect(failureRow.recall).toBeNull();
    expect(failureRow.precision).toBeNull();
    expect(failureRow.citationAccuracy).toBeNull();
    const detail = failureRow.actualOutput as { error: string | null };
    expect(detail.error).toBeTruthy();
    expect(detail.error).toMatch(/zero files/);

    // The two good cases still ran normally alongside the corrupt one.
    const goodRows = rows.filter((r) => r.id !== failureRow.id);
    expect(goodRows.every((r) => r.pass !== null)).toBe(true);

    await app.close();
  });

  it('an agent with zero eval cases ⇒ success, cases_total 0, null batch, zero rows (AC-21)', async () => {
    const app = await appWith(new MockLLMProvider('openai', { structured: REVIEW_FIXTURE }));
    const agent = await createAgent(app);

    const res = await app.inject({ method: 'POST', url: `/agents/${agent.id}/eval-runs` });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ batch_id: null, cases_total: 0 });

    await app.close();
  });

  it('every row of a batch carries the SAME non-null batch_id and agent_version (AC-22)', async () => {
    const app = await appWith(new MockLLMProvider('openai', { structured: REVIEW_FIXTURE }));
    const agent = await createAgent(app);
    await createCase(app, agent.id);
    await createCase(app, agent.id);
    await createCase(app, agent.id);

    const res = await app.inject({ method: 'POST', url: `/agents/${agent.id}/eval-runs` });
    const { batch_id: batchId } = res.json();
    const rows = await waitForBatchRows(pg.handle.db, batchId, 3);

    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.batchId === batchId)).toBe(true);
    const versions = new Set(rows.map((r) => r.agentVersion));
    expect(versions.size).toBe(1);
    expect([...versions][0]).toBe(agent.version);

    await app.close();
  });

  it('a second batch request for an agent already running is rejected with 409 (AC-23)', async () => {
    const inner = new MockLLMProvider('openai', { structured: REVIEW_FIXTURE });
    const app = await appWith(delayedProvider(inner, 60));
    const agent = await createAgent(app);
    await createCase(app, agent.id);
    await createCase(app, agent.id);
    await createCase(app, agent.id);

    const first = await app.inject({ method: 'POST', url: `/agents/${agent.id}/eval-runs` });
    expect(first.statusCode).toBe(202);
    const second = await app.inject({ method: 'POST', url: `/agents/${agent.id}/eval-runs` });
    expect(second.statusCode).toBe(409);

    // Let the first batch finish so it doesn't leak into the next test.
    await waitForBatchRows(pg.handle.db, first.json().batch_id, 3);
    await app.close();
  });

  it("re-running a case after its source PR's files changed still uses the ORIGINAL frozen diff (AC-24)", async () => {
    const inner = new MockLLMProvider('openai', { structured: REVIEW_FIXTURE });
    // No `git` override — SimpleGitClient has no real clone here, so
    // `loadDiff` falls through to reconstructing the diff from `pr_files`
    // (the same documented fallback `diff-loader.ts` already implements).
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { embedder: new MockEmbedder(), llm: { openai: inner } },
    });

    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name: `frozen-diff-${randomUUID()}`, fullName: `acme/frozen-${randomUUID()}` })
      .returning();
    const [pull] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId: repo!.id,
        number: 900,
        title: 'Frozen diff PR',
        author: 'a',
        branch: 'b',
        base: 'main',
        headSha: 'sha1',
        additions: 1,
        deletions: 0,
        filesCount: 1,
        status: 'needs_review',
      })
      .returning();
    await pg.handle.db.insert(t.prFiles).values({
      prId: pull!.id,
      path: 'src/config.ts',
      additions: 1,
      deletions: 0,
      patch: '@@ -10,3 +10,4 @@\n   port: 3000,\n+  stripeKey: "sk_live_xxx",\n   redisUrl: x,',
    });

    const agent = await createAgent(app);
    await app.inject({ method: 'POST', url: `/pulls/${pull!.id}/review`, payload: { agentId: agent.id } });
    // Wait for the (real) review to persist so we have a decided finding.
    let findingId: string | undefined;
    for (let i = 0; i < 200 && !findingId; i++) {
      const reviews = (await app.inject({ method: 'GET', url: `/pulls/${pull!.id}/reviews` })).json();
      if (reviews[0]?.findings?.[0]) findingId = reviews[0].findings[0].id;
      else await new Promise((r) => setTimeout(r, 20));
    }
    expect(findingId).toBeDefined();
    await app.inject({ method: 'POST', url: `/findings/${findingId}/accept` });
    const created = await app.inject({ method: 'POST', url: `/findings/${findingId}/eval-case` });
    expect(created.statusCode).toBe(201);
    const caseId = created.json().id;
    expect(created.json().input_diff).toContain('stripeKey');

    // The source PR's files change AFTER the case was captured.
    await pg.handle.db
      .update(t.prFiles)
      .set({ patch: '@@ -1,1 +1,2 @@\n line1\n+MUTATED_MARKER_NOT_IN_ORIGINAL\n' })
      .where(eq(t.prFiles.prId, pull!.id));

    const runRes = await app.inject({ method: 'POST', url: `/eval-cases/${caseId}/run` });
    expect(runRes.statusCode).toBe(202);
    await waitForBatchRows(pg.handle.db, runRes.json().batch_id, 1);

    const promptsSeen = inner.calls
      .filter((c) => c.method === 'completeStructured')
      .map((c) => JSON.stringify((c.req as { messages: unknown }).messages));
    expect(promptsSeen.some((p) => p.includes('stripeKey'))).toBe(true);
    expect(promptsSeen.some((p) => p.includes('MUTATED_MARKER_NOT_IN_ORIGINAL'))).toBe(false);

    await app.close();
  });

  it('compare: old/new/signed delta for all four metrics, both system prompts, and the only-in-one-side case counts (AC-26, AC-29)', async () => {
    const app = await appWith(new MockLLMProvider('openai', { structured: REVIEW_FIXTURE }));
    const agent = await createAgent(app, 'v1 prompt');
    const case1 = await createCase(app, agent.id);
    const case2 = await createCase(app, agent.id);

    // Bump the agent to v2 with a different system prompt (agent_versions
    // snapshot v1 already exists from creation; v2 is written now).
    await app.inject({ method: 'PUT', url: `/agents/${agent.id}`, payload: { system_prompt: 'v2 prompt' } });

    const batchA = randomUUID(); // older — covers case1 ONLY
    await insertRunRow(case1.id, batchA, 1, {
      counts: { must_find: 2, matched: 1, actual: 4, noise: 1, dropped: 1 },
      cost: 0.01,
    });

    const batchB = randomUUID(); // newer — covers case1 AND case2
    await insertRunRow(case1.id, batchB, 2, {
      counts: { must_find: 2, matched: 2, actual: 4, noise: 0, dropped: 0 },
      cost: 0.02,
    });
    await insertRunRow(case2.id, batchB, 2, {
      counts: { must_find: 2, matched: 1, actual: 2, noise: 0, dropped: 0 },
      cost: 0.03,
    });

    // Query params intentionally reversed (a=newer, b=older) — the response
    // must still order by ran_at, not by query-param position.
    const res = await app.inject({ method: 'GET', url: `/eval-batches/compare?a=${batchB}&b=${batchA}` });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.a.batch_id).toBe(batchA);
    expect(body.b.batch_id).toBe(batchB);
    // batchA: recall 1/2=0.5, precision (4-1)/4=0.75, citation 4/5=0.8
    expect(body.a.recall).toBeCloseTo(0.5);
    expect(body.a.precision).toBeCloseTo(0.75);
    expect(body.a.citation_accuracy).toBeCloseTo(0.8);
    // batchB pooled: recall (2+1)/(2+2)=0.75, precision (4+2)/(4+2)=1, citation 6/6=1
    expect(body.b.recall).toBeCloseTo(0.75);
    expect(body.b.precision).toBeCloseTo(1);
    expect(body.b.citation_accuracy).toBeCloseTo(1);

    expect(body.delta.recall).toBeCloseTo(0.25);
    expect(body.delta.precision).toBeCloseTo(0.25);
    expect(body.delta.citation_accuracy).toBeCloseTo(0.2);
    expect(body.delta.cost_usd).toBeCloseTo(0.05 - 0.01);

    expect(body.system_prompt_a).toBe('v1 prompt');
    expect(body.system_prompt_b).toBe('v2 prompt');

    // case2 exists only in the newer batch.
    expect(body.cases_only_in_a).toBe(0);
    expect(body.cases_only_in_b).toBe(1);

    await app.close();
  });

  it('a batch with a null agent_version still returns numeric deltas, with that side\'s system_prompt null (AC-28)', async () => {
    const app = await appWith(new MockLLMProvider('openai', { structured: REVIEW_FIXTURE }));
    const agent = await createAgent(app, 'null-version prompt');
    const c = await createCase(app, agent.id);
    await app.inject({ method: 'PUT', url: `/agents/${agent.id}`, payload: { system_prompt: 'recorded prompt v2' } });

    const olderBatch = randomUUID(); // pre-extension row: agent_version null
    await insertRunRow(c.id, olderBatch, null, {
      counts: { must_find: 2, matched: 1, actual: 2, noise: 0, dropped: 0 },
      cost: 0.01,
    });
    const newerBatch = randomUUID();
    await insertRunRow(c.id, newerBatch, 2, {
      counts: { must_find: 2, matched: 2, actual: 2, noise: 0, dropped: 0 },
      cost: 0.02,
    });

    const res = await app.inject({
      method: 'GET',
      url: `/eval-batches/compare?a=${olderBatch}&b=${newerBatch}`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.a.agent_version).toBeNull();
    expect(body.system_prompt_a).toBeNull();
    expect(body.system_prompt_b).toBe('recorded prompt v2');
    // Numeric deltas are still computed even though one side has no recorded version.
    expect(body.delta.recall).toBeCloseTo(0.5);

    await app.close();
  });

  it("comparing two batches of DIFFERENT agents is rejected with 422", async () => {
    const app = await appWith(new MockLLMProvider('openai', { structured: REVIEW_FIXTURE }));
    const agentA = await createAgent(app);
    const agentB = await createAgent(app);
    const caseA = await createCase(app, agentA.id);
    const caseB = await createCase(app, agentB.id);

    const batchA = randomUUID();
    await insertRunRow(caseA.id, batchA, agentA.version, { counts: ZERO_COUNTS });
    const batchB = randomUUID();
    await insertRunRow(caseB.id, batchB, agentB.version, { counts: ZERO_COUNTS });

    const res = await app.inject({ method: 'GET', url: `/eval-batches/compare?a=${batchA}&b=${batchB}` });
    expect(res.statusCode).toBe(422);

    await app.close();
  });

  it('per-agent dashboard: current + delta + trend + pass/total + recent_batches (AC-33)', async () => {
    const app = await appWith(new MockLLMProvider('openai', { structured: REVIEW_FIXTURE }));
    const agent = await createAgent(app);
    const case1 = await createCase(app, agent.id);
    const case2 = await createCase(app, agent.id);

    const olderBatch = randomUUID();
    await insertRunRow(case1.id, olderBatch, agent.version, {
      counts: { must_find: 1, matched: 0, actual: 1, noise: 1, dropped: 0 },
      pass: false,
    });
    await insertRunRow(case2.id, olderBatch, agent.version, {
      counts: { must_find: 1, matched: 1, actual: 1, noise: 0, dropped: 0 },
      pass: true,
    });

    const newerBatch = randomUUID();
    await insertRunRow(case1.id, newerBatch, agent.version, {
      counts: { must_find: 1, matched: 1, actual: 1, noise: 0, dropped: 0 },
      pass: true,
    });
    await insertRunRow(case2.id, newerBatch, agent.version, {
      counts: { must_find: 1, matched: 1, actual: 1, noise: 0, dropped: 0 },
      pass: true,
    });

    const res = await app.inject({ method: 'GET', url: `/agents/${agent.id}/eval-dashboard` });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.owner_kind).toBe('agent');
    expect(body.owner_id).toBe(agent.id);
    expect(body.cases_total).toBe(2);
    // Newest batch: both cases matched, no noise ⇒ recall=1, precision=1.
    expect(body.current.recall).toBeCloseTo(1);
    expect(body.current.traces_passed).toBe(2);
    expect(body.current.traces_total).toBe(2);
    // Delta vs the older (worse) batch is positive.
    expect(body.delta.recall).toBeGreaterThan(0);
    expect(body.trend.length).toBeGreaterThanOrEqual(2);
    // Trend is chronological — oldest first.
    expect(body.trend[0].ran_at <= body.trend[body.trend.length - 1].ran_at).toBe(true);
    expect(body.recent_batches.length).toBeGreaterThanOrEqual(2);
    // Recent batches are newest-first.
    expect(body.recent_batches[0].batch_id).toBe(newerBatch);
    expect(body.alert).toBeNull();

    await app.close();
  });

  it('workspace dashboard: one row per enabled agent + the flat cross-agent run list (AC-35)', async () => {
    const app = await appWith(new MockLLMProvider('openai', { structured: REVIEW_FIXTURE }));
    const agent = await createAgent(app);
    const c = await createCase(app, agent.id);
    const batchId = randomUUID();
    await insertRunRow(c.id, batchId, agent.version, {
      counts: { must_find: 1, matched: 1, actual: 1, noise: 0, dropped: 0 },
      pass: true,
    });

    const res = await app.inject({ method: 'GET', url: '/eval-dashboard' });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.workspace.owner_kind).toBeNull();
    expect(body.workspace.owner_id).toBeNull();
    const row = body.agents.find((a: { agent_id: string }) => a.agent_id === agent.id);
    expect(row).toBeDefined();
    expect(row.enabled).toBe(true);
    expect(row.cases_total).toBe(1);
    expect(row.last_batch.batch_id).toBe(batchId);
    expect(Array.isArray(row.recall_trend)).toBe(true);
    expect(body.workspace.recent_runs.some((r: { case_id: string }) => r.case_id === c.id)).toBe(true);

    await app.close();
  });
});
