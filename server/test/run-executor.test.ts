/**
 * Hermetic unit tests for `ReviewRunExecutor.runOneAgent`'s Project Context
 * (SPEC-01, step 5) wiring: resolving the agent's effective attached-doc set
 * via `ContextService.resolveEffectiveSpecs`, forwarding it into
 * `runAgentReview`, and persisting `specs_read` / `stats.specs_tokens` on the
 * success trace (AC-19/AC-21/AC-23) without failing the run when a doc is
 * skipped.
 *
 * `ContextService` is `new`'d directly inside `run-executor.ts` (not
 * container-injected — matches the `SkillsService` precedent), so it is
 * mocked at the module level here rather than via a container override. Its
 * own resolution logic (union/dedup/path-guard/read) is covered by
 * `test/context.test.ts` (hermetic) and `test/context.it.test.ts` (real PG)
 * — out of scope for this file, which only asserts run-executor's wiring.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AgentRow, PullRow } from '../src/db/rows.js';
import type { Container } from '../src/platform/container.js';
import type { ReviewRepository } from '../src/modules/reviews/repository.js';
import * as schema from '../src/db/schema.js';
import { RunBus } from '../src/platform/sse.js';
import { MockLLMProvider } from '../src/adapters/mocks.js';
import type { UnifiedDiff } from '@devdigest/shared';

const DIFF: UnifiedDiff = {
  raw: '--- a/src/foo.ts\n+++ b/src/foo.ts\n@@ -1,1 +1,2 @@\n line1\n+line2\n',
  files: [{ path: 'src/foo.ts', additions: 1, deletions: 0, hunks: [] }],
};

const resolveEffectiveSpecsMock = vi.fn();

vi.mock('../src/modules/context/service.js', () => ({
  ContextService: vi.fn().mockImplementation(() => ({
    resolveEffectiveSpecs: resolveEffectiveSpecsMock,
  })),
}));

// Imported AFTER the mock so `run-executor.ts` picks up the mocked ContextService.
const { ReviewRunExecutor } = await import('../src/modules/reviews/run-executor.js');

const BASE_REVIEW = { verdict: 'approve', summary: 'Looks good', score: 100, findings: [] };

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
    repoIntel: false,
    enabled: true,
    version: 1,
    createdBy: null,
    createdAt: new Date(),
    ...overrides,
  } as AgentRow;
}

function makePull(overrides: Partial<PullRow> = {}): PullRow {
  return {
    id: 'pr-1',
    workspaceId: 'ws-1',
    repoId: 'repo-1',
    number: 42,
    title: 'Add feature',
    author: 'octocat',
    branch: 'feature',
    base: 'main',
    headSha: 'sha123',
    lastReviewedSha: null,
    additions: 1,
    deletions: 0,
    filesCount: 1,
    status: 'needs_review',
    body: null,
    openedAt: null,
    updatedAt: null,
    ...overrides,
  } as PullRow;
}

const REPO = { id: 'repo-1', owner: 'acme', name: 'widgets' } as unknown as typeof schema.repos.$inferSelect;

function makeReviewRepo(overrides: Partial<ReviewRepository> = {}): ReviewRepository {
  return {
    getIntent: vi.fn().mockResolvedValue(undefined),
    insertReview: vi.fn().mockResolvedValue({ id: 'review-1' }),
    insertFindings: vi.fn().mockResolvedValue([]),
    markReviewed: vi.fn().mockResolvedValue(undefined),
    completeAgentRun: vi.fn().mockResolvedValue(undefined),
    saveRunTrace: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as ReviewRepository;
}

function makeContainer(runBus: RunBus): Container {
  const llm = new MockLLMProvider('openai', { structured: BASE_REVIEW });
  return {
    llm: async () => llm,
    agentsRepo: { linkedSkills: async () => [] },
    repoIntel: {},
    runBus,
    tokenizer: { count: (text: string) => text.length },
    git: { diff: async () => DIFF },
  } as unknown as Container;
}

describe('ReviewRunExecutor.runOneAgent — Project Context wiring (SPEC-01)', () => {
  beforeEach(() => {
    resolveEffectiveSpecsMock.mockReset();
  });

  it('persists specs_read (AC-21) and stats.specs_tokens (AC-23) on the success trace, and forwards specs into the prompt', async () => {
    resolveEffectiveSpecsMock.mockResolvedValue({
      specs: ['Path: specs/x.md\n\n# X\nDo the thing.'],
      read: ['specs/x.md'],
      skipped: [],
    });

    const runBus = new RunBus();
    const container = makeContainer(runBus);
    const reviewRepo = makeReviewRepo();
    const executor = new ReviewRunExecutor(container, reviewRepo, container.agentsRepo);

    await executor.executeRuns('ws-1', makePull(), REPO, [{ agent: makeAgent(), runId: 'run-1' }]);

    expect(resolveEffectiveSpecsMock).toHaveBeenCalledWith(
      { owner: 'acme', name: 'widgets' },
      expect.objectContaining({ id: 'agent-1' }),
      expect.objectContaining({ info: expect.any(Function), warn: expect.any(Function), error: expect.any(Function) }),
    );

    expect(reviewRepo.completeAgentRun).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ status: 'done' }),
    );

    const [, trace] = (reviewRepo.saveRunTrace as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(trace.specs_read).toEqual(['specs/x.md']);
    expect(trace.prompt_assembly.specs).toContain('specs/x.md');
    expect(trace.stats.specs_tokens).toBeGreaterThan(0);
  });

  it('does NOT fail the run when a doc is skipped (AC-19) — trace records specs_read without the skipped path', async () => {
    resolveEffectiveSpecsMock.mockResolvedValue({
      specs: [],
      read: [],
      skipped: ['specs/missing.md'],
    });

    const runBus = new RunBus();
    const container = makeContainer(runBus);
    const reviewRepo = makeReviewRepo();
    const executor = new ReviewRunExecutor(container, reviewRepo, container.agentsRepo);

    await executor.executeRuns('ws-1', makePull(), REPO, [{ agent: makeAgent(), runId: 'run-2' }]);

    // Run completes successfully — a skipped doc never fails the run.
    expect(reviewRepo.completeAgentRun).toHaveBeenCalledWith(
      'run-2',
      expect.objectContaining({ status: 'done' }),
    );

    const [, trace] = (reviewRepo.saveRunTrace as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(trace.specs_read).toEqual([]);
    expect(trace.stats.specs_tokens).toBe(0);
    // No specs injected → the prompt has no "## Project context" block.
    expect(trace.prompt_assembly.specs).toBeFalsy();
  });
});
