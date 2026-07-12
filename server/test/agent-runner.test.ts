/**
 * Hermetic unit tests for the shared `runAgentReview` extraction
 * (`modules/reviews/agent-runner.ts`). No DB, no network: `container.llm`,
 * `container.repoIntel`, and `container.agentsRepo` are all mocked.
 *
 * These pin the behaviour-preserving contract from `run-executor.ts`'s
 * original `runOneAgent` middle section: repo-intel enrichment gating,
 * task/rankNote composition, and running without a log / onEvent /
 * checkCancelled.
 */
import { describe, it, expect } from 'vitest';
import type { AgentRow } from '../src/db/rows.js';
import type { Container } from '../src/platform/container.js';
import type { RepoIntel } from '../src/modules/repo-intel/types.js';
import type { UnifiedDiff } from '@devdigest/shared';
import { MockLLMProvider } from '../src/adapters/mocks.js';
import { runAgentReview } from '../src/modules/reviews/agent-runner.js';

const BASE_REVIEW = { verdict: 'approve', summary: 'Looks good', score: 100, findings: [] };

const DIFF: UnifiedDiff = {
  raw: '--- a/src/foo.ts\n+++ b/src/foo.ts\n@@ -1,1 +1,2 @@\n line1\n+line2\n',
  files: [{ path: 'src/foo.ts', additions: 1, deletions: 0, hunks: [] }],
};

function makeAgent(overrides: Partial<AgentRow> = {}): AgentRow {
  return {
    id: 'agent-1',
    workspaceId: 'ws-1',
    name: 'Test Agent',
    description: '',
    provider: 'openai',
    model: 'gpt-4.1',
    systemPrompt: 'You are a reviewer.',
    outputSchema: null,
    strategy: 'single-pass',
    ciFailOn: 'critical',
    repoIntel: true,
    enabled: true,
    version: 1,
    createdBy: null,
    createdAt: new Date(),
    ...overrides,
  } as AgentRow;
}

function makeContainer(opts: { llm?: MockLLMProvider; repoIntel?: Partial<RepoIntel> } = {}): Container {
  const llm = opts.llm ?? new MockLLMProvider('openai', { structured: BASE_REVIEW });
  return {
    llm: async () => llm,
    agentsRepo: { linkedSkills: async () => [] },
    repoIntel: opts.repoIntel ?? {},
  } as unknown as Container;
}

describe('runAgentReview', () => {
  it('agent.repoIntel === false omits all enrichment (prompt identical to the repo-intel-off baseline)', async () => {
    const repoIntelCalls: string[] = [];
    const repoIntel: Partial<RepoIntel> = {
      getCallerSignatures: async () => {
        repoIntelCalls.push('callers');
        return [];
      },
      getRepoMap: async () => {
        repoIntelCalls.push('repoMap');
        return { text: '', tokens: 0, cached: false };
      },
      getFileRank: async () => {
        repoIntelCalls.push('fileRank');
        return [];
      },
    };
    const container = makeContainer({ repoIntel });
    const agent = makeAgent({ repoIntel: false });

    const outcome = await runAgentReview(container, {
      repoId: 'repo-1',
      diff: DIFF,
      agent,
      taskPrefix: 'Review this PR.',
      sessionId: 'session-1',
    });

    // The enrichment facade is never even called — skipped entirely, not just empty.
    expect(repoIntelCalls).toEqual([]);
    expect(outcome.assembly.callers).toBeFalsy();
    expect(outcome.assembly.repo_map).toBeFalsy();
    expect(outcome.assembly.user).not.toContain('## Callers of changed symbols');
    expect(outcome.assembly.user).not.toContain('## Repo skeleton');
    expect(outcome.assembly.user).not.toContain('top 5% most-depended-on');
    expect(outcome.assembly.user).toContain('Review this PR.');
  });

  it('with a mock repoIntel returning callers/repoMap/rank, those sections are present', async () => {
    const repoIntel: Partial<RepoIntel> = {
      getCallerSignatures: async () => [
        { file: 'src/foo.ts', symbol: 'doThing', signature: 'function doThing()', rank: 1 },
      ],
      getRepoMap: async () => ({ text: 'a.ts:\n  function a()', tokens: 10, cached: true }),
      getFileRank: async () => [{ path: 'src/foo.ts', percentile: 99 }],
    };
    const container = makeContainer({ repoIntel });
    const agent = makeAgent({ repoIntel: true });

    const outcome = await runAgentReview(container, {
      repoId: 'repo-1',
      diff: DIFF,
      agent,
      taskPrefix: 'Review this PR.',
      sessionId: 'session-1',
    });

    expect(outcome.assembly.callers).toContain('doThing');
    expect(outcome.assembly.repo_map).toContain('function a()');
    expect(outcome.assembly.user).toContain('## Callers of changed symbols');
    expect(outcome.assembly.user).toContain('## Repo skeleton');
  });

  it('composes the task from taskPrefix + the rank note', async () => {
    const repoIntel: Partial<RepoIntel> = {
      getCallerSignatures: async () => [],
      getRepoMap: async () => ({ text: '', tokens: 0, cached: false }),
      getFileRank: async () => [{ path: 'src/foo.ts', percentile: 99 }],
    };
    const container = makeContainer({ repoIntel });
    const agent = makeAgent({ repoIntel: true });

    const outcome = await runAgentReview(container, {
      repoId: 'repo-1',
      diff: DIFF,
      agent,
      taskPrefix: 'Review this PR.',
      sessionId: 'session-1',
    });

    expect(outcome.assembly.user).toContain(
      'Review this PR.\n\n1 of 1 changed file(s) are in the top 5% most-depended-on',
    );
  });

  it('runs without error with a no-op log and omitted onEvent/checkCancelled', async () => {
    const container = makeContainer();
    const agent = makeAgent({ repoIntel: false });

    await expect(
      runAgentReview(container, {
        repoId: 'repo-1',
        diff: DIFF,
        agent,
        taskPrefix: 'Review this PR.',
        sessionId: 'session-1',
        // log, onEvent, and checkCancelled are all intentionally omitted.
      }),
    ).resolves.toMatchObject({ review: { verdict: 'approve' } });
  });
});
