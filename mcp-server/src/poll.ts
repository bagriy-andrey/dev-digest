/**
 * `pollRunUntilDone` — waits for a triggered review run to reach a terminal
 * state. `POST /pulls/:id/review` is fire-and-forget (spec §0), so
 * `run_agent_on_pr` must poll `GET /pulls/:id/runs` until the run's status
 * settles, then read `GET /pulls/:id/reviews` separately.
 *
 * Pure-ish logic: time is injected via `now`/`sleep` so unit tests can fake
 * elapsed time without real delays. This function only waits for a terminal
 * state — it does not interpret `failed`/`cancelled`; the caller decides what
 * to do with those.
 */

import type { ApiClient } from './api/client.js';
import type { RunSummaryDto } from './api/types.js';
import { ForwardError } from './errors.js';

const TERMINAL_STATUSES = new Set(['done', 'failed', 'cancelled']);

function realSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type PollOptions = {
  intervalMs: number;
  timeoutMs: number;
  /** Injectable clock — defaults to `Date.now`. */
  now?: () => number;
  /** Injectable delay — defaults to a real `setTimeout`-based sleep. */
  sleep?: (ms: number) => Promise<void>;
};

export async function pollRunUntilDone(
  client: ApiClient,
  prId: string,
  runId: string,
  opts: PollOptions,
): Promise<RunSummaryDto> {
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? realSleep;
  const start = now();

  for (;;) {
    const runs = await client.listRuns(prId);
    const match = runs.find((r) => r.run_id === runId);
    if (match && match.status !== null && TERMINAL_STATUSES.has(match.status)) {
      return match;
    }

    if (now() - start >= opts.timeoutMs) {
      const elapsedSeconds = Math.round((now() - start) / 1000);
      throw new ForwardError(
        `Run still in progress after ${elapsedSeconds}s; call get_findings shortly to check again.`,
        'get_findings',
      );
    }

    await sleep(opts.intervalMs);
  }
}
