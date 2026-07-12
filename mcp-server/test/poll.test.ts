import { describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../src/api/client.js';
import type { RunSummaryDto } from '../src/api/types.js';
import { ForwardError } from '../src/errors.js';
import { pollRunUntilDone } from '../src/poll.js';

function mockClient(listRuns: ApiClient['listRuns']): ApiClient {
  return {
    listRepos: vi.fn(async () => []),
    listPulls: vi.fn(async () => []),
    listAgents: vi.fn(async () => []),
    triggerReview: vi.fn(),
    listRuns,
    listReviews: vi.fn(async () => []),
    listConventions: vi.fn(async () => []),
  };
}

function runRow(overrides: Partial<RunSummaryDto>): RunSummaryDto {
  return {
    run_id: 'run-1',
    agent_id: 'agent-1',
    agent_name: 'security-reviewer',
    status: 'running',
    error: null,
    findings_count: null,
    score: null,
    ...overrides,
  };
}

/** Fake clock/sleep so the poll loop advances instantly under test. */
function fakeClock(intervalMs: number) {
  let elapsed = 0;
  const now = () => elapsed;
  const sleep = vi.fn(async (ms: number) => {
    elapsed += ms;
  });
  return { now, sleep, intervalMs };
}

describe('pollRunUntilDone', () => {
  it('resolves once the matching run reaches done', async () => {
    const listRuns = vi
      .fn<ApiClient['listRuns']>()
      .mockResolvedValueOnce([runRow({ status: 'running' })])
      .mockResolvedValueOnce([runRow({ status: 'running' })])
      .mockResolvedValueOnce([runRow({ status: 'done', findings_count: 3 })]);
    const client = mockClient(listRuns);
    const { now, sleep, intervalMs } = fakeClock(10);

    const result = await pollRunUntilDone(client, 'pr-1', 'run-1', {
      intervalMs,
      timeoutMs: 10_000,
      now,
      sleep,
    });

    expect(result.status).toBe('done');
    expect(listRuns).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it.each(['failed', 'cancelled'] as const)(
    'resolves on terminal status "%s" without interpreting it',
    async (status) => {
      const listRuns = vi.fn<ApiClient['listRuns']>().mockResolvedValueOnce([runRow({ status })]);
      const client = mockClient(listRuns);
      const { now, sleep } = fakeClock(10);

      const result = await pollRunUntilDone(client, 'pr-1', 'run-1', {
        intervalMs: 10,
        timeoutMs: 10_000,
        now,
        sleep,
      });

      expect(result.status).toBe(status);
    },
  );

  it('rejects with a ForwardError on overall timeout', async () => {
    const listRuns = vi.fn<ApiClient['listRuns']>().mockResolvedValue([runRow({ status: 'running' })]);
    const client = mockClient(listRuns);
    const { now, sleep } = fakeClock(1_000);

    await expect(
      pollRunUntilDone(client, 'pr-1', 'run-1', {
        intervalMs: 1_000,
        timeoutMs: 3_000,
        now,
        sleep,
      }),
    ).rejects.toThrow(ForwardError);
  });

  it('treats a never-appearing run row as a timeout, not a separate error type', async () => {
    const listRuns = vi.fn<ApiClient['listRuns']>().mockResolvedValue([]);
    const client = mockClient(listRuns);
    const { now, sleep } = fakeClock(1_000);

    await expect(
      pollRunUntilDone(client, 'pr-1', 'missing-run', {
        intervalMs: 1_000,
        timeoutMs: 2_000,
        now,
        sleep,
      }),
    ).rejects.toThrow(/call get_findings shortly/);
  });
});
