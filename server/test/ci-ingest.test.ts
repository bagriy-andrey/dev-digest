/**
 * Hermetic unit tests for `CiIngestService` (SPEC-04, PLAN-04 step 3). No
 * DB, no network: `container.githubActions()` resolves a fixture-driven
 * `MockActionsClient` (`adapters/mocks.ts`), and `CiIngestService`'s
 * private `repo: CiRepository` field is overwritten post-construction with
 * a minimal stub (same "overwrite a stored sibling field" trick as
 * `ci-export.test.ts`/`brief`/`onboarding`'s hermetic tests).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Container } from '../src/platform/container.js';
import { CiIngestService } from '../src/modules/ci/ingest-service.js';
import { MockActionsClient } from '../src/adapters/mocks.js';
import * as ingestRegistry from '../src/modules/ci/ingest-registry.js';
import type { CiInstallationRow, WorkflowRunSummary } from '../src/modules/ci/types.js';
import type { UpsertCiRunInput } from '../src/modules/ci/repository.js';

beforeEach(() => {
  ingestRegistry.__resetForTests();
});

function makeInstallation(overrides: Partial<CiInstallationRow> = {}): CiInstallationRow {
  return {
    id: 'installation-1',
    agent_id: 'agent-1',
    agent_name: 'Security Reviewer',
    repo: 'acme/widgets',
    target_type: 'gha',
    installed_at: '2026-01-01T00:00:00.000Z',
    latest_run: null,
    ...overrides,
  };
}

function makeRun(overrides: Partial<WorkflowRunSummary> = {}): WorkflowRunSummary {
  return {
    id: 'run-1',
    html_url: 'https://github.com/acme/widgets/actions/runs/1',
    status: 'completed',
    conclusion: 'success',
    head_branch: 'devdigest/ci',
    run_started_at: '2026-06-01T00:00:00Z',
    pull_requests: [{ number: 42 }],
    ...overrides,
  };
}

interface StubRepo {
  listInstallations: ReturnType<typeof vi.fn>;
  existingRunKeys: ReturnType<typeof vi.fn>;
  upsertRunWithAgentRun: ReturnType<typeof vi.fn>;
}

function makeStubRepo(opts: {
  installations?: CiInstallationRow[];
  existingKeys?: Map<string, string>;
} = {}): StubRepo {
  return {
    listInstallations: vi.fn().mockResolvedValue(opts.installations ?? [makeInstallation()]),
    existingRunKeys: vi.fn().mockResolvedValue(opts.existingKeys ?? new Map()),
    upsertRunWithAgentRun: vi.fn().mockResolvedValue(undefined),
  };
}

function makeService(opts: {
  repo?: StubRepo;
  actions?: MockActionsClient;
} = {}): { service: CiIngestService; repo: StubRepo; actions: MockActionsClient } {
  const repo = opts.repo ?? makeStubRepo();
  const actions = opts.actions ?? new MockActionsClient();

  const container = {
    githubActions: vi.fn().mockResolvedValue(actions),
  } as unknown as Container;

  const service = new CiIngestService(container);
  (service as unknown as { repo: StubRepo }).repo = repo;

  return { service, repo, actions };
}

function upsertedFor(repo: StubRepo, workflowRunId: string): UpsertCiRunInput | undefined {
  const call = repo.upsertRunWithAgentRun.mock.calls.find(
    ([input]: [UpsertCiRunInput]) => input.workflowRunId === workflowRunId,
  );
  return call?.[0];
}

describe('CiIngestService.refresh', () => {
  it('a malformed artifact payload is rejected and nothing from it is persisted (AC-46)', async () => {
    const actions = new MockActionsClient({
      runs: [makeRun({ id: 'run-bad' })],
      artifactsByRun: { 'run-bad': [{ id: 'artifact-bad', name: 'devdigest-result', expired: false }] },
      artifactJsonByArtifact: { 'artifact-bad': { findings_count: 'not-a-number' } },
    });
    const { service, repo } = makeService({ actions });

    const summary = await service.refresh('ws-1');

    expect(summary.artifactsInvalid).toBe(1);
    const written = upsertedFor(repo, 'run-bad');
    expect(written).toMatchObject({ status: 'failed', findingsCount: null, costUsd: null });
  });

  it('status derivation: in-progress ⇒ running', async () => {
    const actions = new MockActionsClient({
      runs: [makeRun({ id: 'run-running', status: 'in_progress', conclusion: null })],
    });
    const { service, repo } = makeService({ actions });

    await service.refresh('ws-1');

    expect(upsertedFor(repo, 'run-running')).toMatchObject({ status: 'running' });
  });

  it('status derivation: artifact with findings ⇒ succeeded EVEN when conclusion is "failure" (gate-blocked, AC-49)', async () => {
    const actions = new MockActionsClient({
      runs: [makeRun({ id: 'run-gate', conclusion: 'failure' })],
      artifactsByRun: {
        'run-gate': [{ id: 'artifact-gate', name: 'devdigest-result', expired: false }],
      },
      artifactJsonByArtifact: {
        'artifact-gate': {
          findings_count: 3,
          cost_usd: 0.02,
          agent: 'Security Reviewer',
        },
      },
    });
    const { service, repo } = makeService({ actions });

    await service.refresh('ws-1');

    expect(upsertedFor(repo, 'run-gate')).toMatchObject({ status: 'succeeded', findingsCount: 3 });
  });

  it('status derivation: conclusion "failure" with no artifact ⇒ failed', async () => {
    const actions = new MockActionsClient({
      runs: [makeRun({ id: 'run-fail', conclusion: 'failure' })],
      artifactsByRun: { 'run-fail': [] },
    });
    const { service, repo } = makeService({ actions });

    await service.refresh('ws-1');

    expect(upsertedFor(repo, 'run-fail')).toMatchObject({ status: 'failed', findingsCount: null });
  });

  it('status derivation: artifact with zero findings ⇒ no_findings', async () => {
    const actions = new MockActionsClient({
      runs: [makeRun({ id: 'run-clean', conclusion: 'success' })],
      artifactsByRun: {
        'run-clean': [{ id: 'artifact-clean', name: 'devdigest-result', expired: false }],
      },
      artifactJsonByArtifact: {
        'artifact-clean': { findings_count: 0, cost_usd: 0.01, agent: 'Security Reviewer' },
      },
    });
    const { service, repo } = makeService({ actions });

    await service.refresh('ws-1');

    expect(upsertedFor(repo, 'run-clean')).toMatchObject({ status: 'no_findings', findingsCount: 0 });
  });

  it('status derivation: skipped/cancelled ⇒ NOT persisted at all', async () => {
    const actions = new MockActionsClient({
      runs: [
        makeRun({ id: 'run-skipped', conclusion: 'skipped' }),
        makeRun({ id: 'run-cancelled', conclusion: 'cancelled' }),
      ],
    });
    const { service, repo } = makeService({ actions });

    await service.refresh('ws-1');

    expect(repo.upsertRunWithAgentRun).not.toHaveBeenCalled();
  });

  it('github_url always comes from the run object, even when the artifact carries a URL-shaped field (AC-50)', async () => {
    const actions = new MockActionsClient({
      runs: [
        makeRun({
          id: 'run-url',
          html_url: 'https://github.com/acme/widgets/actions/runs/999',
          conclusion: 'success',
        }),
      ],
      artifactsByRun: { 'run-url': [{ id: 'artifact-url', name: 'devdigest-result', expired: false }] },
      artifactJsonByArtifact: {
        // Extra, unrecognized fields (including a url-shaped one) are simply
        // stripped by CiResultArtifact.safeParse — never trusted for github_url.
        'artifact-url': {
          findings_count: 1,
          cost_usd: 0.01,
          agent: 'Security Reviewer',
          html_url: 'https://evil.example.com/not-the-real-url',
        },
      },
    });
    const { service, repo } = makeService({ actions });

    await service.refresh('ws-1');

    expect(upsertedFor(repo, 'run-url')).toMatchObject({
      githubUrl: 'https://github.com/acme/widgets/actions/runs/999',
    });
  });

  it('a second refresh for the same repo while one is already in flight is skipped (AC-53)', async () => {
    ingestRegistry.tryAcquire('acme/widgets');
    const { service, repo, actions } = makeService();

    const summary = await service.refresh('ws-1');

    expect(summary.skipped).toBe(1);
    expect(summary.installationsChecked).toBe(0);
    expect(repo.upsertRunWithAgentRun).not.toHaveBeenCalled();
    expect(actions.listRunArtifactsCalls).toEqual([]);
  });

  it('an already-ingested TERMINAL run does not trigger an artifact download (D7)', async () => {
    const actions = new MockActionsClient({ runs: [makeRun({ id: 'run-old' })] });
    const repo = makeStubRepo({ existingKeys: new Map([['run-old', 'succeeded']]) });
    const { service } = makeService({ repo, actions });

    await service.refresh('ws-1');

    expect(actions.listRunArtifactsCalls).toEqual([]);
    expect(repo.upsertRunWithAgentRun).not.toHaveBeenCalled();
  });

  it('a previously "running" row IS re-examined (only terminal rows are skipped, D7)', async () => {
    const actions = new MockActionsClient({
      runs: [makeRun({ id: 'run-now-done', conclusion: 'success' })],
      artifactsByRun: {
        'run-now-done': [{ id: 'artifact-done', name: 'devdigest-result', expired: false }],
      },
      artifactJsonByArtifact: {
        'artifact-done': { findings_count: 2, cost_usd: 0.01, agent: 'Security Reviewer' },
      },
    });
    const repo = makeStubRepo({ existingKeys: new Map([['run-now-done', 'running']]) });
    const { service } = makeService({ repo, actions });

    await service.refresh('ws-1');

    expect(upsertedFor(repo, 'run-now-done')).toMatchObject({ status: 'succeeded' });
  });

  it('an expired artifact is treated as missing — never downloaded, run persists as failed', async () => {
    const actions = new MockActionsClient({
      runs: [makeRun({ id: 'run-expired', conclusion: 'success' })],
      artifactsByRun: {
        'run-expired': [{ id: 'artifact-expired', name: 'devdigest-result', expired: true }],
      },
    });
    const { service, repo } = makeService({ actions });

    await service.refresh('ws-1');

    expect(actions.downloadArtifactCalls).toEqual([]);
    expect(upsertedFor(repo, 'run-expired')).toMatchObject({ status: 'failed' });
  });

  it('a fork run with no pull_requests[] falls back to the artifact pr_number (AC-51)', async () => {
    const actions = new MockActionsClient({
      runs: [makeRun({ id: 'run-fork', conclusion: 'success', pull_requests: [] })],
      artifactsByRun: {
        'run-fork': [{ id: 'artifact-fork', name: 'devdigest-result', expired: false }],
      },
      artifactJsonByArtifact: {
        'artifact-fork': {
          findings_count: 1,
          cost_usd: 0.01,
          agent: 'Security Reviewer',
          pr_number: 77,
        },
      },
    });
    const { service, repo } = makeService({ actions });

    await service.refresh('ws-1');

    expect(upsertedFor(repo, 'run-fork')).toMatchObject({ prNumber: 77 });
  });

  it('an API error for one installation is caught, recorded, and does not throw out of refresh() (AC-52)', async () => {
    const badActions = new MockActionsClient();
    badActions.listWorkflowRuns = vi.fn().mockRejectedValue(new Error('secondary rate limit exceeded'));

    // The per-installation try/catch (`refreshInstallation`) is what AC-52
    // relies on: a thrown API error is caught, recorded as a failure with
    // its reason, and `refresh()` still resolves — it never rejects the
    // whole pass, and this installation's rows are left byte-identical
    // (nothing is written for it at all).
    const repo = makeStubRepo({
      installations: [makeInstallation({ id: 'installation-bad', repo: 'acme/broken' })],
    });
    const { service } = makeService({ repo, actions: badActions });

    const summary = await service.refresh('ws-1');

    expect(summary.failures).toEqual([
      { repo: 'acme/broken', reason: 'secondary rate limit exceeded' },
    ]);
    expect(repo.upsertRunWithAgentRun).not.toHaveBeenCalled();
  });
});
