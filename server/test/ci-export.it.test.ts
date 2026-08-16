/**
 * Export-to-CI: `POST /agents/:id/export-ci` end to end (SPEC-04, PLAN-04
 * step 3 — AC-18, AC-22, AC-24). Real Postgres via testcontainers; GitHub is
 * still mocked (`MockGitHubClient` via `ContainerOverrides.github`) — this
 * suite exercises the ROUTE + DB write path, not a real GitHub API call.
 * See `server/insights.md` if this suite can't start a container in your
 * sandbox (a documented environment limitation, not a code regression) —
 * write/typecheck this file and verify by close reading regardless.
 */
import { randomUUID } from 'node:crypto';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq, and } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockGitHubClient } from '../src/adapters/mocks.js';
import { AgentsRepository } from '../src/modules/agents/repository.js';
import * as t from '../src/db/schema.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[ci-export] Docker not available — skipping integration tests.');
}

d('Export-to-CI: POST /agents/:id/export-ci (SPEC-04 step 3)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let bundleDir: string;
  let bundlePath: string;

  beforeAll(async () => {
    pg = await startPg();
    const seeded = await seed(pg.handle.db);
    workspaceId = seeded.workspaceId;
    bundleDir = mkdtempSync(join(tmpdir(), 'ci-export-it-'));
    bundlePath = join(bundleDir, 'index.js');
    writeFileSync(bundlePath, '// mock runner bundle\n');
  });
  afterAll(async () => {
    await pg?.stop();
    rmSync(bundleDir, { recursive: true, force: true });
  });

  function config() {
    return loadConfig({
      ...process.env,
      NODE_ENV: 'test',
      DEVDIGEST_RUNNER_BUNDLE: bundlePath,
    } as NodeJS.ProcessEnv);
  }

  function appWith(github = new MockGitHubClient()) {
    return buildApp({ config: config(), db: pg.handle.db, overrides: { github } });
  }

  async function createAgent(app: Awaited<ReturnType<typeof buildApp>>) {
    const res = await app.inject({
      method: 'POST',
      url: '/agents',
      payload: {
        name: `CI Export Agent ${randomUUID()}`,
        provider: 'openrouter',
        model: 'deepseek/deepseek-v4-flash',
        system_prompt: 'You are a CI export test agent.',
      },
    });
    return res.json();
  }

  it('accepts CiExportInput and returns CiExport (AC-18)', async () => {
    const app = await appWith();
    const agent = await createAgent(app);
    const repoName = `acme/ci-export-${randomUUID()}`;

    const res = await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/export-ci`,
      payload: { repo: repoName, action: 'files' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.pr_url).toBeNull();
    expect(Array.isArray(body.files)).toBe(true);
    expect(body.files.length).toBeGreaterThan(0);
    expect(body.installation.repo).toBe(repoName);
    await app.close();
  });

  it('an export records one ci_installations row; a re-export updates rather than duplicates (AC-22)', async () => {
    const github = new MockGitHubClient();
    const app = await appWith(github);
    const agent = await createAgent(app);
    const repoName = `acme/ci-export-upsert-${randomUUID()}`;

    const first = await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/export-ci`,
      payload: { repo: repoName, action: 'open_pr', base: 'main' },
    });
    expect(first.statusCode).toBe(200);

    const second = await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/export-ci`,
      payload: { repo: repoName, action: 'open_pr', base: 'main' },
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().installation.id).toBe(first.json().installation.id);

    const rows = await pg.handle.db
      .select()
      .from(t.ciInstallations)
      .where(
        and(eq(t.ciInstallations.agentId, agent.id as string), eq(t.ciInstallations.repo, repoName)),
      );
    expect(rows).toHaveLength(1);

    // Both calls committed to the fixed CI branch, never `base`.
    expect(github.committed.every((c) => c.branch === 'devdigest/ci')).toBe(true);
    await app.close();
  });

  it('an agent id from another workspace is rejected, not exported (AC-24)', async () => {
    const [otherWs] = await pg.handle.db
      .insert(t.workspaces)
      .values({ name: `other-ci-export-${randomUUID()}` })
      .returning();
    const repo = new AgentsRepository(pg.handle.db);
    const foreignAgent = await repo.insert({
      workspaceId: otherWs!.id,
      name: 'Foreign Agent',
      provider: 'openai',
      model: 'gpt-4o-mini',
      systemPrompt: 'x',
    });

    const app = await appWith();
    const res = await app.inject({
      method: 'POST',
      url: `/agents/${foreignAgent.id}/export-ci`,
      payload: { repo: `acme/ci-export-foreign-${randomUUID()}`, action: 'files' },
    });

    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('declares a rateLimit config on POST /agents/:id/export-ci (source-read — behaviourally inert under NODE_ENV=test, server/insights.md)', () => {
    const source = readFileSync(new URL('../src/modules/ci/routes.ts', import.meta.url), 'utf8');
    const idx = source.indexOf("'/agents/:id/export-ci'");
    expect(idx).toBeGreaterThan(-1);
    const block = source.slice(idx, idx + 400);
    expect(block).toContain('rateLimit');
  });
});
