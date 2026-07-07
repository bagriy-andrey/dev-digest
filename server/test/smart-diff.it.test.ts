import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

let repoSeq = 0;
async function setupRepoAndPr(db: PgFixture['handle']['db'], workspaceId: string) {
  const name = `smart-diff-${repoSeq++}`;
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

d('smart-diff (Testcontainers pg)', () => {
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

  it('groups files core -> wiring -> boilerplate and overlays the newest review\'s findings', async () => {
    const app = await appWith();
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    await pg.handle.db.insert(t.prFiles).values([
      { prId: pr.id, path: 'src/middleware/ratelimit.ts', additions: 84, deletions: 0, patch: null },
      { prId: pr.id, path: 'src/config.ts', additions: 4, deletions: 0, patch: null },
      { prId: pr.id, path: 'package-lock.json', additions: 92, deletions: 24, patch: null },
    ]);

    // Older review — should NOT be the one overlaid.
    const [olderReview] = await pg.handle.db
      .insert(t.reviews)
      .values({
        workspaceId,
        prId: pr.id,
        agentId: null,
        runId: null,
        kind: 'review',
        verdict: 'request_changes',
        summary: 'old',
        score: 50,
        model: 'gpt-4.1',
      })
      .returning();
    await pg.handle.db.insert(t.findings).values({
      reviewId: olderReview!.id,
      file: 'src/config.ts',
      startLine: 999,
      endLine: 999,
      severity: 'WARNING',
      category: 'bug',
      title: 'stale finding',
      rationale: 'from an older review — must not appear in the overlay',
      confidence: 0.5,
      kind: 'finding',
    });

    // Newest review — this one's findings should be overlaid.
    const [newerReview] = await pg.handle.db
      .insert(t.reviews)
      .values({
        workspaceId,
        prId: pr.id,
        agentId: null,
        runId: null,
        kind: 'review',
        verdict: 'request_changes',
        summary: 'new',
        score: 65,
        model: 'gpt-4.1',
      })
      .returning();
    await pg.handle.db.insert(t.findings).values([
      {
        reviewId: newerReview!.id,
        file: 'src/middleware/ratelimit.ts',
        startLine: 28,
        endLine: 28,
        severity: 'SUGGESTION',
        category: 'bug',
        title: 'off-by-one on the token bucket window',
        rationale: 'first request in a fresh window is not expired.',
        confidence: 0.7,
        kind: 'finding',
      },
      {
        reviewId: newerReview!.id,
        file: 'src/middleware/ratelimit.ts',
        startLine: 28,
        endLine: 28,
        severity: 'WARNING',
        category: 'bug',
        title: 'duplicate location, distinct finding',
        rationale: 'dedupe check: same start_line as the finding above.',
        confidence: 0.6,
        kind: 'finding',
      },
    ]);

    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/smart-diff` });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.groups.map((g: { role: string }) => g.role)).toEqual([
      'core',
      'wiring',
      'boilerplate',
    ]);

    const core = body.groups.find((g: { role: string }) => g.role === 'core');
    const wiring = body.groups.find((g: { role: string }) => g.role === 'wiring');
    const boilerplate = body.groups.find((g: { role: string }) => g.role === 'boilerplate');

    expect(core.files.map((f: { path: string }) => f.path)).toEqual([
      'src/middleware/ratelimit.ts',
    ]);
    expect(wiring.files.map((f: { path: string }) => f.path)).toEqual(['src/config.ts']);
    expect(boilerplate.files.map((f: { path: string }) => f.path)).toEqual(['package-lock.json']);

    // Newest review's finding overlay only (deduped to one line-28 entry),
    // older review's line-999 finding must not appear anywhere.
    expect(core.files[0].finding_lines).toEqual([28]);
    expect(wiring.files[0].finding_lines).toEqual([]);
    expect(boilerplate.files[0].finding_lines).toEqual([]);

    // No LLM call anywhere in this path.
    expect(core.files[0].pseudocode_summary).toBeNull();
    expect(wiring.files[0].pseudocode_summary).toBeNull();
    expect(boilerplate.files[0].pseudocode_summary).toBeNull();

    expect(body.split_suggestion).toEqual({
      too_big: false,
      total_lines: 200,
      proposed_splits: [],
    });

    await app.close();
  });

  it('returns empty groups and a valid split_suggestion for a PR with no files and no reviews', async () => {
    const app = await appWith();
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/smart-diff` });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.groups).toEqual([
      { role: 'core', files: [] },
      { role: 'wiring', files: [] },
      { role: 'boilerplate', files: [] },
    ]);
    expect(body.split_suggestion).toEqual({
      too_big: false,
      total_lines: 0,
      proposed_splits: [],
    });

    await app.close();
  });

  it('404s for a PR id that does not belong to the caller\'s workspace', async () => {
    const app = await appWith();
    const [otherWs] = await pg.handle.db
      .insert(t.workspaces)
      .values({ name: 'other-workspace' })
      .returning();
    const { pr } = await setupRepoAndPr(pg.handle.db, otherWs!.id);

    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/smart-diff` });
    expect(res.statusCode).toBe(404);

    await app.close();
  });
});
