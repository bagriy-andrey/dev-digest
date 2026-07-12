/**
 * Unit tests for `cli/review.ts` (`runReview`) and `cli/format.ts`
 * (`formatResults`/`hasBlockingFindings`/`SEVERITY_ORDER`) — spec step M3.
 *
 * `runReview` is exercised against a mock `ApiClient` + mock `GitPort`, no
 * live server and no real shelling out, mirroring the `mockClient` pattern
 * in `tools.test.ts` and the `GitPort` mocking style in `git.test.ts`.
 */
import { describe, expect, it, vi } from 'vitest';

import type { ApiClient } from '../src/api/client.js';
import type { AgentReviewResult, ReviewDiffFinding } from '../src/api/types.js';
import type { GitPort } from '../src/git.js';
import { runReview } from '../src/cli/review.js';
import { formatResults, hasBlockingFindings, SEVERITY_ORDER } from '../src/cli/format.js';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function mockApi(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    listRepos: vi.fn(async () => []),
    listPulls: vi.fn(async () => []),
    listAgents: vi.fn(async () => []),
    triggerReview: vi.fn(),
    listRuns: vi.fn(async () => []),
    listReviews: vi.fn(async () => []),
    listConventions: vi.fn(async () => []),
    reviewDiff: vi.fn(async () => []),
    ...overrides,
  };
}

function mockGit(overrides: Partial<GitPort> = {}): GitPort {
  return {
    diff: vi.fn(async () => 'diff --git a/x b/x\n+hello\n'),
    remoteUrl: vi.fn(async () => 'git@github.com:acme/widgets.git'),
    ...overrides,
  };
}

function collectingWriters(): { out: (l: string) => void; err: (l: string) => void; outLines: string[]; errLines: string[] } {
  const outLines: string[] = [];
  const errLines: string[] = [];
  return {
    out: (l: string) => outLines.push(l),
    err: (l: string) => errLines.push(l),
    outLines,
    errLines,
  };
}

function finding(overrides: Partial<ReviewDiffFinding> = {}): ReviewDiffFinding {
  return {
    id: 'f1',
    severity: 'CRITICAL',
    category: 'security',
    title: 'SQL injection',
    file: 'src/db.ts',
    start_line: 12,
    end_line: 14,
    rationale: 'Unsanitized input flows into a raw query.',
    confidence: 0.9,
    ...overrides,
  };
}

function agentResult(overrides: Partial<AgentReviewResult> = {}): AgentReviewResult {
  return {
    agent: { id: 'agent-1', name: 'Security Reviewer' },
    verdict: 'comment',
    score: 80,
    blockers: 0,
    findings: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// runReview
// ---------------------------------------------------------------------------

describe('runReview', () => {
  it('empty diff: prints "No local changes to review.", returns 0, does not call reviewDiff', async () => {
    const api = mockApi();
    const git = mockGit({ diff: vi.fn(async () => '   \n  ') });
    const writers = collectingWriters();

    const code = await runReview({ api, git, mode: 'working', out: writers.out, err: writers.err });

    expect(code).toBe(0);
    expect(writers.outLines).toEqual(['No local changes to review.']);
    expect(api.reviewDiff).not.toHaveBeenCalled();
    expect(api.listRepos).not.toHaveBeenCalled();
  });

  it('unresolvable remote: returns 2, does not call the API', async () => {
    const api = mockApi();
    const git = mockGit({ remoteUrl: vi.fn(async () => 'not-a-git-url') });
    const writers = collectingWriters();

    const code = await runReview({ api, git, mode: 'working', out: writers.out, err: writers.err });

    expect(code).toBe(2);
    expect(writers.errLines[0]).toMatch(/could not determine the origin remote/i);
    expect(api.reviewDiff).not.toHaveBeenCalled();
  });

  it('repo not in listRepos: prints the "not imported" message, returns 2', async () => {
    const api = mockApi({
      listRepos: vi.fn(async () => [{ id: 'r1', owner: 'other', name: 'thing', full_name: 'other/thing' }]),
    });
    const git = mockGit();
    const writers = collectingWriters();

    const code = await runReview({ api, git, mode: 'working', out: writers.out, err: writers.err });

    expect(code).toBe(2);
    expect(writers.errLines[0]).toMatch(/acme\/widgets/);
    expect(writers.errLines[0]).toMatch(/isn't imported/i);
    expect(api.reviewDiff).not.toHaveBeenCalled();
  });

  it('a result with blockers > 0 returns 1', async () => {
    const api = mockApi({
      listRepos: vi.fn(async () => [{ id: 'repo-uuid', owner: 'acme', name: 'widgets', full_name: 'acme/widgets' }]),
      reviewDiff: vi.fn(async () => [agentResult({ blockers: 1, findings: [finding()] })]),
    });
    const git = mockGit();
    const writers = collectingWriters();

    const code = await runReview({ api, git, mode: 'working', out: writers.out, err: writers.err });

    expect(code).toBe(1);
    expect(api.reviewDiff).toHaveBeenCalledWith('repo-uuid', 'diff --git a/x b/x\n+hello\n');
    expect(writers.outLines[0]).toContain('Security Reviewer');
  });

  it('a clean result (no blockers) returns 0', async () => {
    const api = mockApi({
      listRepos: vi.fn(async () => [{ id: 'repo-uuid', owner: 'acme', name: 'widgets', full_name: 'acme/widgets' }]),
      reviewDiff: vi.fn(async () => [agentResult({ blockers: 0, findings: [] })]),
    });
    const git = mockGit();
    const writers = collectingWriters();

    const code = await runReview({ api, git, mode: 'working', out: writers.out, err: writers.err });

    expect(code).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// formatResults / hasBlockingFindings
// ---------------------------------------------------------------------------

describe('formatResults', () => {
  it('renders a one-line "no findings" for a clean agent', () => {
    const text = formatResults([agentResult({ findings: [] })]);
    expect(text).toContain('No findings.');
    expect(text).toContain('Security Reviewer');
  });

  it('groups findings by severity per SEVERITY_ORDER and renders file:start_line + title + rationale', () => {
    const results = [
      agentResult({
        blockers: 1,
        findings: [
          finding({ id: 'w1', severity: 'WARNING', title: 'Missing null check', file: 'src/a.ts', start_line: 5 }),
          finding({ id: 's1', severity: 'SUGGESTION', title: 'Rename var', file: 'src/b.ts', start_line: 9 }),
          finding({ id: 'c1', severity: 'CRITICAL', title: 'SQL injection', file: 'src/db.ts', start_line: 12 }),
        ],
      }),
    ];

    const text = formatResults(results);

    const criticalIdx = text.indexOf('CRITICAL:');
    const warningIdx = text.indexOf('WARNING:');
    const suggestionIdx = text.indexOf('SUGGESTION:');
    expect(criticalIdx).toBeGreaterThanOrEqual(0);
    expect(warningIdx).toBeGreaterThan(criticalIdx);
    expect(suggestionIdx).toBeGreaterThan(warningIdx);

    expect(text).toContain('src/db.ts:12');
    expect(text).toContain('SQL injection');
    expect(text).toContain('Unsanitized input flows into a raw query.');
    expect(text).toContain('src/a.ts:5');
    expect(text).toContain('Missing null check');
    expect(text).toContain('src/b.ts:9');
    expect(text).toContain('Rename var');
  });

  it('SEVERITY_ORDER is CRITICAL, WARNING, SUGGESTION', () => {
    expect(SEVERITY_ORDER).toEqual(['CRITICAL', 'WARNING', 'SUGGESTION']);
  });
});

describe('hasBlockingFindings', () => {
  it('is true when any result has blockers > 0', () => {
    expect(hasBlockingFindings([agentResult({ blockers: 0 }), agentResult({ blockers: 2 })])).toBe(true);
  });

  it('is false when every result has zero blockers', () => {
    expect(hasBlockingFindings([agentResult({ blockers: 0 }), agentResult({ blockers: 0 })])).toBe(false);
  });
});
