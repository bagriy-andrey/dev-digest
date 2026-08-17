import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq, and } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { CiRepository } from '../src/modules/ci/repository.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[ci-repository] Docker not available — skipping integration tests.');
}

/**
 * CiRepository (SPEC-04 step 1). Real Postgres via testcontainers — see
 * `server/insights.md` if this suite can't start a container in your sandbox
 * (it is a documented environment limitation, not a code regression).
 */
d('CiRepository', () => {
  let pg: PgFixture;
  let repo: CiRepository;
  let workspaceId: string;

  beforeAll(async () => {
    pg = await startPg();
    const { workspaceId: ws } = await seed(pg.handle.db);
    workspaceId = ws;
    repo = new CiRepository(pg.handle.db);
  });
  afterAll(async () => {
    await pg?.stop();
  });

  async function makeAgent(overrides: Partial<typeof t.agents.$inferInsert> = {}) {
    const [agent] = await pg.handle.db
      .insert(t.agents)
      .values({
        workspaceId,
        name: `CI Repo Test Agent ${randomUUID()}`,
        provider: 'openrouter',
        model: 'deepseek/deepseek-v4-flash',
        systemPrompt: 'You are a CI test agent.',
        ...overrides,
      })
      .returning();
    return agent!;
  }

  describe('ci_installations', () => {
    it('upserting the same (agent, repo, target) twice yields exactly one row (AC-22)', async () => {
      const agent = await makeAgent();
      const repoName = `acme/ci-repo-${randomUUID()}`;

      const first = await repo.upsertInstallation(agent.id, repoName, 'gha');
      const second = await repo.upsertInstallation(agent.id, repoName, 'gha');

      expect(second.id).toBe(first.id);

      const rows = await pg.handle.db
        .select()
        .from(t.ciInstallations)
        .where(
          and(eq(t.ciInstallations.agentId, agent.id), eq(t.ciInstallations.repo, repoName)),
        );
      expect(rows).toHaveLength(1);

      // Re-installing bumps installed_at rather than leaving it untouched.
      expect(new Date(second.installed_at).getTime()).toBeGreaterThanOrEqual(
        new Date(first.installed_at).getTime(),
      );
    });

    it('findInstallation is workspace + agent + repo + target scoped', async () => {
      const agent = await makeAgent();
      const repoName = `acme/ci-find-${randomUUID()}`;
      await repo.upsertInstallation(agent.id, repoName, 'gha');

      const found = await repo.findInstallation(workspaceId, agent.id, repoName, 'gha');
      expect(found).toBeDefined();
      expect(found?.repo).toBe(repoName);

      // Wrong target type / wrong repo / wrong workspace all miss.
      expect(await repo.findInstallation(workspaceId, agent.id, repoName, 'circle')).toBeUndefined();
      expect(await repo.findInstallation(workspaceId, agent.id, 'other/repo', 'gha')).toBeUndefined();
      expect(
        await repo.findInstallation(randomUUID(), agent.id, repoName, 'gha'),
      ).toBeUndefined();
    });

    it('listInstallations returns the agent name and each installation\'s latest run', async () => {
      const agent = await makeAgent({ name: `Listable Agent ${randomUUID()}` });
      const repoName = `acme/ci-list-${randomUUID()}`;
      const installation = await repo.upsertInstallation(agent.id, repoName, 'gha');

      const beforeAnyRuns = await repo.listInstallations(workspaceId, agent.id);
      const row = beforeAnyRuns.find((r) => r.id === installation.id);
      expect(row?.agent_name).toBe(agent.name);
      expect(row?.latest_run).toBeNull();

      await repo.upsertRunWithAgentRun({
        ciInstallationId: installation.id,
        workflowRunId: `wf-${randomUUID()}`,
        status: 'succeeded',
        prNumber: 7,
        ranAt: new Date(),
        findingsCount: 2,
        costUsd: 0.01,
        githubUrl: 'https://github.com/acme/ci-list/actions/runs/1',
        durationMs: 4000,
      });

      const afterRun = await repo.listInstallations(workspaceId, agent.id);
      const rowAfter = afterRun.find((r) => r.id === installation.id);
      expect(rowAfter?.latest_run).not.toBeNull();
      expect(rowAfter?.latest_run?.status).toBe('succeeded');
    });
  });

  describe('upsertRunWithAgentRun (AC-47 / AC-48)', () => {
    it('writes ci_runs + agent_runs together, in one transaction, correctly linked', async () => {
      const agent = await makeAgent({
        provider: 'anthropic',
        model: 'claude-sonnet-test',
      });
      const repoName = `acme/ci-pair-${randomUUID()}`;
      const installation = await repo.upsertInstallation(agent.id, repoName, 'gha');
      const workflowRunId = `wf-${randomUUID()}`;

      await repo.upsertRunWithAgentRun({
        ciInstallationId: installation.id,
        workflowRunId,
        status: 'succeeded',
        prNumber: 42,
        ranAt: new Date('2026-08-01T00:00:00.000Z'),
        findingsCount: 3,
        costUsd: 0.05,
        githubUrl: 'https://github.com/acme/ci-pair/actions/runs/1',
        durationMs: 12_000,
      });

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
      expect(ciRun!.agentRunId).not.toBeNull();
      expect(ciRun!.status).toBe('succeeded');
      // AC-51 — no PR was ever imported for this CI run; pr_id doesn't even
      // exist on ci_runs, but pr_number (the only PR reference it carries)
      // must still persist even though nothing links it to a `pull_requests` row.
      expect(ciRun!.prNumber).toBe(42);

      const [agentRun] = await pg.handle.db
        .select()
        .from(t.agentRuns)
        .where(eq(t.agentRuns.id, ciRun!.agentRunId!));
      expect(agentRun).toBeDefined();
      expect(agentRun!.source).toBe('ci');
      expect(agentRun!.workspaceId).toBe(workspaceId);
      expect(agentRun!.provider).toBe('anthropic');
      expect(agentRun!.model).toBe('claude-sonnet-test');
      expect(agentRun!.tokensIn).toBeNull();
      expect(agentRun!.tokensOut).toBeNull();
      expect(agentRun!.prId).toBeNull();
      expect(agentRun!.durationMs).toBe(12_000);
    });

    it('re-ingesting the same workflow_run_id UPDATES both rows instead of duplicating (AC-48)', async () => {
      const agent = await makeAgent();
      const repoName = `acme/ci-reingest-${randomUUID()}`;
      const installation = await repo.upsertInstallation(agent.id, repoName, 'gha');
      const workflowRunId = `wf-${randomUUID()}`;

      await repo.upsertRunWithAgentRun({
        ciInstallationId: installation.id,
        workflowRunId,
        status: 'running',
        prNumber: 5,
        ranAt: null,
        findingsCount: null,
        costUsd: null,
        githubUrl: 'https://github.com/acme/ci-reingest/actions/runs/1',
        durationMs: null,
      });

      const firstPass = await pg.handle.db
        .select()
        .from(t.ciRuns)
        .where(
          and(
            eq(t.ciRuns.ciInstallationId, installation.id),
            eq(t.ciRuns.workflowRunId, workflowRunId),
          ),
        );
      expect(firstPass).toHaveLength(1);
      const firstAgentRunId = firstPass[0]!.agentRunId;

      // Second pass: the run finished — same workflow_run_id, terminal status.
      await repo.upsertRunWithAgentRun({
        ciInstallationId: installation.id,
        workflowRunId,
        status: 'succeeded',
        prNumber: 5,
        ranAt: new Date(),
        findingsCount: 1,
        costUsd: 0.02,
        githubUrl: 'https://github.com/acme/ci-reingest/actions/runs/1',
        durationMs: 8000,
      });

      const secondPass = await pg.handle.db
        .select()
        .from(t.ciRuns)
        .where(
          and(
            eq(t.ciRuns.ciInstallationId, installation.id),
            eq(t.ciRuns.workflowRunId, workflowRunId),
          ),
        );
      // Still exactly one ci_runs row — updated, not duplicated.
      expect(secondPass).toHaveLength(1);
      expect(secondPass[0]!.status).toBe('succeeded');
      expect(secondPass[0]!.findingsCount).toBe(1);
      // The SAME agent_runs row was updated, not a second one created.
      expect(secondPass[0]!.agentRunId).toBe(firstAgentRunId);

      const agentRuns = await pg.handle.db
        .select()
        .from(t.agentRuns)
        .where(eq(t.agentRuns.id, firstAgentRunId!));
      expect(agentRuns).toHaveLength(1);
      expect(agentRuns[0]!.status).toBe('done');
      expect(agentRuns[0]!.durationMs).toBe(8000);
    });

    it('never writes ci_runs without a paired agent_runs row (both present after any call)', async () => {
      const agent = await makeAgent();
      const repoName = `acme/ci-pairing-${randomUUID()}`;
      const installation = await repo.upsertInstallation(agent.id, repoName, 'gha');
      const workflowRunId = `wf-${randomUUID()}`;

      await repo.upsertRunWithAgentRun({
        ciInstallationId: installation.id,
        workflowRunId,
        status: 'failed',
        prNumber: null,
        ranAt: new Date(),
        findingsCount: null,
        costUsd: null,
        githubUrl: 'https://github.com/acme/ci-pairing/actions/runs/1',
        durationMs: 3000,
      });

      const [ciRun] = await pg.handle.db
        .select()
        .from(t.ciRuns)
        .where(
          and(
            eq(t.ciRuns.ciInstallationId, installation.id),
            eq(t.ciRuns.workflowRunId, workflowRunId),
          ),
        );
      expect(ciRun!.agentRunId).not.toBeNull();

      const agentRunCount = await pg.handle.db
        .select()
        .from(t.agentRuns)
        .where(eq(t.agentRuns.id, ciRun!.agentRunId!));
      expect(agentRunCount).toHaveLength(1);
    });
  });

  describe('listRuns (AC-40)', () => {
    it('returns the joined agent name, repo, duration and pr_number for a run whose PR was never imported (AC-51)', async () => {
      const agent = await makeAgent({ name: `Runs List Agent ${randomUUID()}` });
      const repoName = `acme/ci-runs-list-${randomUUID()}`;
      const installation = await repo.upsertInstallation(agent.id, repoName, 'gha');
      const workflowRunId = `wf-${randomUUID()}`;

      await repo.upsertRunWithAgentRun({
        ciInstallationId: installation.id,
        workflowRunId,
        status: 'succeeded',
        prNumber: 99,
        ranAt: new Date(),
        findingsCount: 4,
        costUsd: 0.03,
        githubUrl: 'https://github.com/acme/ci-runs-list/actions/runs/1',
        durationMs: 6000,
      });

      const runs = await repo.listRuns(workspaceId, 100);
      const found = runs.find((r) => r.repo === repoName);
      expect(found).toBeDefined();
      expect(found?.agent).toBe(agent.name);
      expect(found?.duration_s).toBe(6);
      // AC-51 — no pull_requests row backs this pr_number; it still persists.
      expect(found?.pr_number).toBe(99);
    });
  });

  describe('existingRunKeys (D7 skip-list)', () => {
    it('returns a workflowRunId -> status map for one installation', async () => {
      const agent = await makeAgent();
      const repoName = `acme/ci-keys-${randomUUID()}`;
      const installation = await repo.upsertInstallation(agent.id, repoName, 'gha');
      const runningId = `wf-${randomUUID()}`;
      const doneId = `wf-${randomUUID()}`;

      await repo.upsertRunWithAgentRun({
        ciInstallationId: installation.id,
        workflowRunId: runningId,
        status: 'running',
        prNumber: null,
        ranAt: null,
        findingsCount: null,
        costUsd: null,
        githubUrl: 'https://github.com/acme/ci-keys/actions/runs/1',
        durationMs: null,
      });
      await repo.upsertRunWithAgentRun({
        ciInstallationId: installation.id,
        workflowRunId: doneId,
        status: 'succeeded',
        prNumber: null,
        ranAt: new Date(),
        findingsCount: 0,
        costUsd: 0,
        githubUrl: 'https://github.com/acme/ci-keys/actions/runs/2',
        durationMs: 1000,
      });

      const keys = await repo.existingRunKeys(installation.id);
      expect(keys.get(runningId)).toBe('running');
      expect(keys.get(doneId)).toBe('succeeded');
    });
  });

  describe('listMemory (D10)', () => {
    it('returns a content-only projection, newest first, capped by limit', async () => {
      const [repoRow] = await pg.handle.db
        .insert(t.repos)
        .values({ workspaceId, owner: 'acme', name: `mem-${randomUUID()}`, fullName: `acme/mem-${randomUUID()}` })
        .returning();

      const entries = ['first', 'second', 'third'];
      for (const content of entries) {
        await pg.handle.db.insert(t.memory).values({
          workspaceId,
          repoId: repoRow!.id,
          scope: 'repo',
          kind: 'learning',
          content,
          confidence: 0.9,
        });
        await new Promise((r) => setTimeout(r, 5));
      }

      const rows = await repo.listMemory(workspaceId, 2);
      expect(rows).toHaveLength(2);
      expect(rows[0]!.content).toBe('third');
      expect(rows[1]!.content).toBe('second');
      // Content-only projection — no `embedding`/`sources` field on any row.
      for (const row of rows) {
        expect(Object.keys(row).sort()).toEqual(
          ['confidence', 'content', 'created_at', 'kind', 'scope'].sort(),
        );
      }
    });
  });
});
