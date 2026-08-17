/**
 * Hermetic unit tests for `CiExportService` (SPEC-04, PLAN-04 step 3). No
 * DB, no network: `container` is a plain object literal cast
 * `as unknown as Container` (`ContainerOverrides` does NOT cover
 * `agentsRepo` — server/insights.md), and `CiExportService`'s private
 * `repo: CiRepository` field is overwritten post-construction with a
 * minimal stub (the same "overwrite a stored sibling field" trick used by
 * `brief`/`onboarding`'s hermetic tests).
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CiExportInput, type CiInstallation } from '@devdigest/shared';
import type { AgentRow } from '../src/db/rows.js';
import type { Container } from '../src/platform/container.js';
import { CiExportService } from '../src/modules/ci/export-service.js';
import { NotFoundError, ValidationError } from '../src/platform/errors.js';
import { MockGitHubClient } from '../src/adapters/mocks.js';

let bundleDir: string;
let bundlePath: string;

beforeAll(() => {
  bundleDir = mkdtempSync(join(tmpdir(), 'ci-export-test-'));
  bundlePath = join(bundleDir, 'index.js');
  writeFileSync(bundlePath, '// mock runner bundle\n');
});

afterAll(() => {
  rmSync(bundleDir, { recursive: true, force: true });
});

function makeAgent(overrides: Partial<AgentRow> = {}): AgentRow {
  return {
    id: 'agent-1',
    workspaceId: 'ws-1',
    name: 'Security Reviewer',
    description: '',
    provider: 'openrouter',
    model: 'deepseek/deepseek-v4-flash',
    systemPrompt: 'You are a careful reviewer.',
    outputSchema: null,
    strategy: 'single-pass',
    ciFailOn: 'critical',
    repoIntel: false,
    enabled: true,
    version: 1,
    createdBy: null,
    createdAt: new Date(),
    ...overrides,
  } as AgentRow;
}

interface StubRepo {
  listMemory: ReturnType<typeof vi.fn>;
  findInstallation: ReturnType<typeof vi.fn>;
  upsertInstallation: ReturnType<typeof vi.fn>;
}

function makeStubRepo(overrides: Partial<StubRepo> = {}): StubRepo {
  return {
    listMemory: vi.fn().mockResolvedValue([]),
    findInstallation: vi.fn().mockResolvedValue(undefined),
    upsertInstallation: vi
      .fn()
      .mockImplementation(
        async (agentId: string, repo: string, target: string): Promise<CiInstallation> => ({
          id: 'installation-1',
          agent_id: agentId,
          repo,
          target_type: target as CiInstallation['target_type'],
          installed_at: new Date().toISOString(),
        }),
      ),
    ...overrides,
  };
}

function makeService(opts: {
  agent?: AgentRow | undefined;
  githubClient?: MockGitHubClient;
  repo?: StubRepo;
} = {}): {
  service: CiExportService;
  githubSpy: ReturnType<typeof vi.fn>;
  github: MockGitHubClient;
  repo: StubRepo;
} {
  const agent = 'agent' in opts ? opts.agent : makeAgent();
  const github = opts.githubClient ?? new MockGitHubClient();
  const githubSpy = vi.fn().mockResolvedValue(github);
  const repo = opts.repo ?? makeStubRepo();

  const container = {
    agentsRepo: {
      getById: vi.fn().mockResolvedValue(agent),
      linkedSkills: vi.fn().mockResolvedValue([]),
    },
    github: githubSpy,
    config: { runnerBundlePath: bundlePath },
  } as unknown as Container;

  const service = new CiExportService(container);
  (service as unknown as { repo: StubRepo }).repo = repo;

  return { service, githubSpy, github, repo };
}

function baseInput(overrides: Partial<Parameters<typeof CiExportInput.parse>[0]> = {}) {
  return CiExportInput.parse({ repo: 'acme/widgets', ...overrides });
}

describe('CiExportService.export', () => {
  it('action: "files" performs zero GitHub calls and returns pr_url: null with a non-persisted installation (AC-21, D4)', async () => {
    const { service, githubSpy, repo } = makeService();
    const input = baseInput({ action: 'files' });

    const result = await service.export('ws-1', 'agent-1', input);

    expect(githubSpy).not.toHaveBeenCalled();
    expect(result.pr_url).toBeNull();
    expect(repo.upsertInstallation).not.toHaveBeenCalled();
    // D4 — transient stand-in, never a real persisted row.
    expect(result.installation.id).toBe('');
    expect(result.installation.repo).toBe('acme/widgets');
    expect(result.files.length).toBeGreaterThan(0);
  });

  it('action: "files" returns the EXISTING installation when one is already on record (D4)', async () => {
    const existing: CiInstallation = {
      id: 'installation-existing',
      agent_id: 'agent-1',
      repo: 'acme/widgets',
      target_type: 'gha',
      installed_at: '2026-01-01T00:00:00.000Z',
    };
    const repo = makeStubRepo({ findInstallation: vi.fn().mockResolvedValue(existing) });
    const { service } = makeService({ repo });

    const result = await service.export('ws-1', 'agent-1', baseInput({ action: 'files' }));

    expect(result.installation).toEqual(existing);
  });

  it('open_pr commits to branch "devdigest/ci" (never `base`) with the full file set (AC-19)', async () => {
    const { service, github, repo } = makeService();
    const input = baseInput({ action: 'open_pr', base: 'main' });

    const result = await service.export('ws-1', 'agent-1', input);

    expect(github.committed).toHaveLength(1);
    expect(github.committed[0]!.branch).toBe('devdigest/ci');
    expect(github.committed[0]!.branch).not.toBe('main');
    expect(github.committed[0]!.base).toBe('main');
    expect(github.committed[0]!.files.length).toBe(result.files.length);
    expect(repo.upsertInstallation).toHaveBeenCalledWith('agent-1', 'acme/widgets', 'gha');
    expect(result.pr_url).toMatch(/^https:\/\/github\.com/);
  });

  it('reuses an existing open PR instead of opening a second one (AC-20)', async () => {
    const github = new MockGitHubClient();
    // Simulate a PR that was already opened by a previous export.
    github.openedPrs.push({
      title: 'Add DevDigest CI review',
      head: 'devdigest/ci',
      base: 'main',
      body: 'existing pr',
    });
    const { service } = makeService({ githubClient: github });

    const result = await service.export('ws-1', 'agent-1', baseInput({ action: 'open_pr' }));

    // No SECOND PR opened for the same branch.
    expect(github.openedPrs).toHaveLength(1);
    expect(result.pr_url).toBe('https://github.com/mock/mock/pull/1');
  });

  it('a commitFiles rejection mentioning workflow permission surfaces a message naming the scope and records no installation (AC-23)', async () => {
    const github = new MockGitHubClient();
    github.commitFiles = vi
      .fn()
      .mockRejectedValue(
        new Error(
          'Refusing to allow a Personal Access Token to create or update workflow ' +
            '`.github/workflows/devdigest-review.yml` without `workflow` scope',
        ),
      );
    const { service, repo } = makeService({ githubClient: github });

    await expect(service.export('ws-1', 'agent-1', baseInput({ action: 'open_pr' }))).rejects.toThrow(
      /workflow/i,
    );
    expect(repo.upsertInstallation).not.toHaveBeenCalled();
  });

  it('a 404 from a git-data write endpoint (trees/refs/commits/blobs) surfaces a Contents-write-permission message, not the raw GitHub 404 (AC-23)', async () => {
    const github = new MockGitHubClient();
    github.commitFiles = vi
      .fn()
      .mockRejectedValue(new Error('Not Found - https://docs.github.com/rest/git/trees#create-a-tree'));
    const { service, repo } = makeService({ githubClient: github });

    await expect(service.export('ws-1', 'agent-1', baseInput({ action: 'open_pr' }))).rejects.toThrow(
      /Contents.*Read and write/i,
    );
    expect(repo.upsertInstallation).not.toHaveBeenCalled();
  });

  it('a non-"gha" target is rejected server-side, not exported (AC-26)', async () => {
    const { service, githubSpy } = makeService();

    await expect(
      service.export('ws-1', 'agent-1', baseInput({ target: 'circle' })),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(githubSpy).not.toHaveBeenCalled();
  });

  it('an agent id outside the workspace is not found, not exported (AC-24)', async () => {
    const { service } = makeService({ agent: undefined });

    await expect(service.export('ws-1', 'agent-1', baseInput())).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('logs agent/repo/target/action/branch/PR URL and NEVER a token or file body (AC-6, §Observability)', async () => {
    const { service } = makeService();
    const info = vi.fn();
    const logger = { info, warn: vi.fn(), error: vi.fn() };

    await service.export('ws-1', 'agent-1', baseInput({ action: 'open_pr' }), logger);

    expect(info).toHaveBeenCalledTimes(1);
    const [loggedObj] = info.mock.calls[0]!;
    expect(loggedObj).toMatchObject({
      agentId: 'agent-1',
      repo: 'acme/widgets',
      target: 'gha',
      action: 'open_pr',
      branch: 'devdigest/ci',
    });
    expect(loggedObj.prUrl).toMatch(/^https:\/\/github\.com/);
    // No file contents / raw bundle text anywhere in the logged payload.
    const serialized = JSON.stringify(loggedObj);
    expect(serialized).not.toContain('mock runner bundle');
    expect(serialized).not.toMatch(/token/i);
    expect(loggedObj).not.toHaveProperty('files');
    expect(loggedObj).not.toHaveProperty('installation');
  });
});
