import { describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../src/api/client.js';
import type { AgentDto, PrMetaDto, RepoDto } from '../src/api/types.js';
import { ForwardError } from '../src/errors.js';
import { resolveAgent, resolvePr, resolveRepo } from '../src/resolvers.js';

/** Plain object mock of `ApiClient` — one `vi.fn()` per method actually used. */
function mockClient(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    listRepos: vi.fn(async () => []),
    listPulls: vi.fn(async () => []),
    listAgents: vi.fn(async () => []),
    triggerReview: vi.fn(),
    listRuns: vi.fn(async () => []),
    listReviews: vi.fn(async () => []),
    listConventions: vi.fn(async () => []),
    ...overrides,
  };
}

const repo: RepoDto = { id: 'repo-1', owner: 'acme', name: 'widgets', full_name: 'acme/widgets' };
const pr: PrMetaDto = {
  id: 'pr-1',
  number: 42,
  title: 'Add feature',
  author: 'alice',
  branch: 'feat',
  base: 'main',
  status: 'open',
};
const agent: AgentDto = {
  id: '11111111-1111-1111-1111-111111111111',
  name: 'security-reviewer',
  description: 'Finds security issues',
  provider: 'openai',
  model: 'gpt-4.1',
  enabled: true,
};

describe('resolveRepo', () => {
  it('resolves owner/name to a repo id (case-insensitive)', async () => {
    const client = mockClient({ listRepos: vi.fn(async () => [repo]) });
    const result = await resolveRepo(client, 'Acme/Widgets');
    expect(result).toEqual({ repoId: 'repo-1' });
  });

  it('throws a ForwardError naming the recovery step on miss', async () => {
    const client = mockClient({ listRepos: vi.fn(async () => [repo]) });
    await expect(resolveRepo(client, 'acme/missing')).rejects.toThrow(ForwardError);
    await expect(resolveRepo(client, 'acme/missing')).rejects.toThrow(
      /Repo "acme\/missing" not found\. Check the spelling, or ask the user which repos are imported\./,
    );
  });
});

describe('resolvePr', () => {
  it('resolves a PR number to a PR id', async () => {
    const client = mockClient({ listPulls: vi.fn(async () => [pr]) });
    const result = await resolvePr(client, 'repo-1', 42);
    expect(result).toEqual({ prId: 'pr-1' });
  });

  it('throws a ForwardError naming the recovery step on miss', async () => {
    const client = mockClient({ listPulls: vi.fn(async () => [pr]) });
    await expect(resolvePr(client, 'repo-1', 999)).rejects.toThrow(ForwardError);
    await expect(resolvePr(client, 'repo-1', 999)).rejects.toThrow(
      /PR #999 not found in this repo\. Check the PR number\./,
    );
  });
});

describe('resolveAgent', () => {
  it('resolves by name', async () => {
    const client = mockClient({ listAgents: vi.fn(async () => [agent]) });
    const result = await resolveAgent(client, 'security-reviewer');
    expect(result).toEqual({ agentId: agent.id, agentName: agent.name });
  });

  it('accepts a UUID directly and returns the real agent name', async () => {
    const client = mockClient({ listAgents: vi.fn(async () => [agent]) });
    const result = await resolveAgent(client, agent.id);
    expect(result).toEqual({ agentId: agent.id, agentName: agent.name });
  });

  it('throws a ForwardError naming list_agents on miss', async () => {
    const client = mockClient({ listAgents: vi.fn(async () => [agent]) });
    await expect(resolveAgent(client, 'no-such-agent')).rejects.toThrow(ForwardError);
    await expect(resolveAgent(client, 'no-such-agent')).rejects.toThrow(
      /Agent "no-such-agent" not found\. Call list_agents to see valid names\/ids\./,
    );
  });
});
