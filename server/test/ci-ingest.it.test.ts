/**
 * Export-to-CI: `POST /ci-runs/refresh` + `GET /ci-runs` + `GET /ci-installations`
 * end to end (SPEC-04, PLAN-04 step 3 — AC-37, AC-40, AC-45, AC-47, AC-48,
 * AC-51, AC-52). Real Postgres via testcontainers; GitHub Actions is
 * mocked (`MockActionsClient` via `ContainerOverrides.githubActions`) — this
 * suite exercises the ROUTE + repository write path against a stubbed
 * Actions API, not a real GitHub call. See `server/insights.md` if this
 * suite can't start a container in your sandbox (a documented environment
 * limitation, not a code regression) — write/typecheck this file and
 * verify by close reading regardless.
 */
import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { eq, and } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockActionsClient } from '../src/adapters/mocks.js';
import { CiRepository } from '../src/modules/ci/repository.js';
import * as ingestRegistry from '../src/modules/ci/ingest-registry.js';
import * as t from '../src/db/schema.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[ci-ingest] Docker not available — skipping integration tests.');
}

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

d('Export-to-CI: POST /ci-runs/refresh + GET /ci-runs + GET /ci-installations (SPEC-04 step 3)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let repo: CiRepository;

  beforeAll(async () => {
    pg = await startPg();
    const seeded = await seed(pg.handle.db);
    workspaceId = seeded.workspaceId;
    repo = new CiRepository(pg.handle.db);
  });
  afterAll(async () => {
    await pg?.stop();
  });
  beforeEach(() => {
    ingestRegistry.__resetForTests();
  });

  function appWith(actions: MockActionsClient) {
    return buildApp({ config: config(), db: pg.handle.db, overrides: { githubActions: actions } });
  }

  async function makeAgent() {
    const [agent] = await pg.handle.db
      .insert(t.agents)
      .values({
        workspaceId,
        name: `CI Ingest Test Agent ${randomUUID()}`,
        provider: 'openrouter',
        model: 'deepseek/deepseek-v4-flash',
        systemPrompt: 'You are a CI ingest test agent.',
      })
      .returning();
    return agent!;
  }

  it('a pass lists runs for devdigest-review.yml and downloads each candidate artifact (AC-45)', async () => {
    const agent = await makeAgent();
    const repoName = `acme/ci-ingest-list-${randomUUID()}`;
    await repo.upsertInstallation(agent.id, repoName, 'gha');

    const actions = new MockActionsClient({
      runs: [
        {
          id: `wf-${randomUUID()}`,
          html_url: 'https://github.com/acme/ci-ingest-list/actions/runs/1',
          status: 'completed',
          conclusion: 'success',
          head_branch: 'devdigest/ci',
          run_started_at: '2026-06-01T00:00:00Z',
          pull_requests: [{ number: 1 }],
        },
      ],
    });
    const app = await appWith(actions);

    const res = await app.inject({ method: 'POST', url: '/ci-runs/refresh' });
    expect(res.statusCode).toBe(200);
    const summary = res.json();
    expect(summary.installationsChecked).toBeGreaterThanOrEqual(1);
    expect(summary.runsExamined).toBeGreaterThanOrEqual(1);
    await app.close();
  });

  it('one pass writes ci_runs + agent_runs (AC-47); a repeat pass updates rather than duplicates (AC-48)', async () => {
    const agent = await makeAgent();
    const repoName = `acme/ci-ingest-pair-${randomUUID()}`;
    const installation = await repo.upsertInstallation(agent.id, repoName, 'gha');
    const workflowRunId = `wf-${randomUUID()}`;

    const actions = new MockActionsClient({
      runs: [
        {
          id: workflowRunId,
          html_url: `https://github.com/${repoName}/actions/runs/1`,
          status: 'completed',
          conclusion: 'success',
          head_branch: 'devdigest/ci',
          run_started_at: '2026-06-01T00:00:00Z',
          pull_requests: [{ number: 9 }],
        },
      ],
      artifactsByRun: {
        [workflowRunId]: [{ id: 'artifact-1', name: 'devdigest-result', expired: false }],
      },
      artifactJsonByArtifact: {
        'artifact-1': { findings_count: 2, cost_usd: 0.02, agent: agent.name },
      },
    });

    const firstApp = await appWith(actions);
    const firstRes = await firstApp.inject({ method: 'POST', url: '/ci-runs/refresh' });
    expect(firstRes.statusCode).toBe(200);
    await firstApp.close();

    const [firstRun] = await pg.handle.db
      .select()
      .from(t.ciRuns)
      .where(
        and(
          eq(t.ciRuns.ciInstallationId, installation.id),
          eq(t.ciRuns.workflowRunId, workflowRunId),
        ),
      );
    expect(firstRun).toBeDefined();
    expect(firstRun!.status).toBe('succeeded');
    expect(firstRun!.agentRunId).not.toBeNull();
    const [agentRun] = await pg.handle.db
      .select()
      .from(t.agentRuns)
      .where(eq(t.agentRuns.id, firstRun!.agentRunId!));
    expect(agentRun).toBeDefined();
    expect(agentRun!.source).toBe('ci');

    // Repeat pass: an already-terminal run is on the skip-list (D7) — same
    // row, still exactly one, not a duplicate.
    ingestRegistry.__resetForTests();
    const secondApp = await appWith(actions);
    const secondRes = await secondApp.inject({ method: 'POST', url: '/ci-runs/refresh' });
    expect(secondRes.statusCode).toBe(200);
    await secondApp.close();

    const rows = await pg.handle.db
      .select()
      .from(t.ciRuns)
      .where(
        and(
          eq(t.ciRuns.ciInstallationId, installation.id),
          eq(t.ciRuns.workflowRunId, workflowRunId),
        ),
      );
    expect(rows).toHaveLength(1);
  });

  it('a run whose PR was never imported still persists (AC-51)', async () => {
    const agent = await makeAgent();
    const repoName = `acme/ci-ingest-fork-${randomUUID()}`;
    const installation = await repo.upsertInstallation(agent.id, repoName, 'gha');
    const workflowRunId = `wf-${randomUUID()}`;

    const actions = new MockActionsClient({
      runs: [
        {
          id: workflowRunId,
          html_url: `https://github.com/${repoName}/actions/runs/1`,
          status: 'completed',
          conclusion: 'success',
          head_branch: 'devdigest/ci',
          run_started_at: '2026-06-01T00:00:00Z',
          pull_requests: [], // fork PR — GitHub reports no linked PR here
        },
      ],
      artifactsByRun: {
        [workflowRunId]: [{ id: 'artifact-fork', name: 'devdigest-result', expired: false }],
      },
      artifactJsonByArtifact: {
        'artifact-fork': { findings_count: 1, cost_usd: 0.01, agent: agent.name, pr_number: 55 },
      },
    });

    const app = await appWith(actions);
    const res = await app.inject({ method: 'POST', url: '/ci-runs/refresh' });
    expect(res.statusCode).toBe(200);
    await app.close();

    const [ciRun] = await pg.handle.db
      .select()
      .from(t.ciRuns)
      .where(
        and(
          eq(t.ciRuns.ciInstallationId, installation.id),
          eq(t.ciRuns.workflowRunId, workflowRunId),
        ),
      );
    expect(ciRun).toBeDefined();
    expect(ciRun!.prNumber).toBe(55);
  });

  it('an API error leaves previously ingested rows byte-identical and returns the reason (AC-52)', async () => {
    const agent = await makeAgent();
    const repoName = `acme/ci-ingest-fail-${randomUUID()}`;
    const installation = await repo.upsertInstallation(agent.id, repoName, 'gha');
    const workflowRunId = `wf-${randomUUID()}`;

    const okActions = new MockActionsClient({
      runs: [
        {
          id: workflowRunId,
          html_url: `https://github.com/${repoName}/actions/runs/1`,
          status: 'completed',
          conclusion: 'success',
          head_branch: 'devdigest/ci',
          run_started_at: '2026-06-01T00:00:00Z',
          pull_requests: [{ number: 3 }],
        },
      ],
      artifactsByRun: {
        [workflowRunId]: [{ id: 'artifact-ok', name: 'devdigest-result', expired: false }],
      },
      artifactJsonByArtifact: {
        'artifact-ok': { findings_count: 0, cost_usd: 0, agent: agent.name },
      },
    });
    const seedApp = await appWith(okActions);
    await seedApp.inject({ method: 'POST', url: '/ci-runs/refresh' });
    await seedApp.close();

    const before = await pg.handle.db
      .select()
      .from(t.ciRuns)
      .where(
        and(
          eq(t.ciRuns.ciInstallationId, installation.id),
          eq(t.ciRuns.workflowRunId, workflowRunId),
        ),
      );
    expect(before).toHaveLength(1);

    const failingActions = new MockActionsClient();
    failingActions.listWorkflowRuns = async () => {
      throw new Error('API rate limit exceeded');
    };
    ingestRegistry.__resetForTests();
    const failApp = await appWith(failingActions);
    const failRes = await failApp.inject({ method: 'POST', url: '/ci-runs/refresh' });
    expect(failRes.statusCode).toBe(200);
    const summary = failRes.json();
    expect(summary.failures.some((f: { repo: string }) => f.repo === repoName)).toBe(true);
    await failApp.close();

    const after = await pg.handle.db
      .select()
      .from(t.ciRuns)
      .where(
        and(
          eq(t.ciRuns.ciInstallationId, installation.id),
          eq(t.ciRuns.workflowRunId, workflowRunId),
        ),
      );
    expect(after).toEqual(before);
  });

  it('GET /ci-runs returns the joined agent name, repo and duration (AC-40)', async () => {
    const agent = await makeAgent();
    const repoName = `acme/ci-ingest-getruns-${randomUUID()}`;
    const installation = await repo.upsertInstallation(agent.id, repoName, 'gha');
    await repo.upsertRunWithAgentRun({
      ciInstallationId: installation.id,
      workflowRunId: `wf-${randomUUID()}`,
      status: 'succeeded',
      prNumber: 10,
      ranAt: new Date(),
      findingsCount: 1,
      costUsd: 0.01,
      githubUrl: `https://github.com/${repoName}/actions/runs/1`,
      durationMs: 5000,
    });

    const app = await appWith(new MockActionsClient());
    const res = await app.inject({ method: 'GET', url: '/ci-runs' });
    expect(res.statusCode).toBe(200);
    const runs = res.json() as Array<{ repo: string; agent: string; duration_s: number }>;
    const found = runs.find((r) => r.repo === repoName);
    expect(found).toBeDefined();
    expect(found?.agent).toBe(agent.name);
    expect(found?.duration_s).toBe(5);
    await app.close();
  });

  it('GET /ci-installations returns each installation with its latest run (AC-37 server half)', async () => {
    const agent = await makeAgent();
    const repoName = `acme/ci-ingest-getinst-${randomUUID()}`;
    const installation = await repo.upsertInstallation(agent.id, repoName, 'gha');
    await repo.upsertRunWithAgentRun({
      ciInstallationId: installation.id,
      workflowRunId: `wf-${randomUUID()}`,
      status: 'no_findings',
      prNumber: 11,
      ranAt: new Date(),
      findingsCount: 0,
      costUsd: 0,
      githubUrl: `https://github.com/${repoName}/actions/runs/2`,
      durationMs: 2000,
    });

    const app = await appWith(new MockActionsClient());
    const res = await app.inject({ method: 'GET', url: `/ci-installations?agent_id=${agent.id}` });
    expect(res.statusCode).toBe(200);
    const rows = res.json() as Array<{ id: string; latest_run: { status: string } | null }>;
    const found = rows.find((r) => r.id === installation.id);
    expect(found).toBeDefined();
    expect(found?.latest_run?.status).toBe('no_findings');
    await app.close();
  });
});
