/**
 * `cli/review.ts` — orchestration for the `devdigest review` CLI (spec
 * §1.B). Deps (`ApiClient`, `GitPort`, `out`/`err` writers) are injected —
 * mirrors `poll.ts`'s inject-for-testability pattern — so `runReview` is
 * unit-tested against a mock `ApiClient` + mock `GitPort`, with no real
 * shelling out or HTTP.
 */

import type { ApiClient } from '../api/client.js';
import type { GitPort, ReviewMode } from '../git.js';
import { parseRemoteUrl } from '../git.js';
import { formatResults, hasBlockingFindings } from './format.js';

export interface ReviewDeps {
  api: ApiClient;
  git: GitPort;
  mode: ReviewMode;
  out: (line: string) => void;
  err: (line: string) => void;
}

/**
 * Runs the pre-push review flow end to end and returns the process exit
 * code (0 = clean, 1 = blocking findings, 2 = usage/resolution error).
 */
export async function runReview(deps: ReviewDeps): Promise<number> {
  const { api, git, mode, out, err } = deps;

  // 1. Empty-diff short-circuit — no local changes, no API call.
  const diff = await git.diff(mode);
  if (diff.trim() === '') {
    out('No local changes to review.');
    return 0;
  }

  // 2. Resolve the origin remote to an owner/name pair.
  const remote = await git.remoteUrl();
  const parsed = parseRemoteUrl(remote);
  if (!parsed) {
    err('Could not determine the origin remote (owner/name).');
    return 2;
  }

  // 3. Match against the imported repos (client-side match, no new server route).
  const repos = await api.listRepos();
  const fullName = `${parsed.owner}/${parsed.name}`;
  const match = repos.find((r) => r.full_name === fullName);
  if (!match) {
    err(`${fullName} isn't imported into DevDigest yet — import it in the studio first.`);
    return 2;
  }

  // 4-5. Run the review and print the report.
  const results = await api.reviewDiff(match.id, diff);
  out(formatResults(results));

  // 6. Exit non-zero iff any agent's server-computed gate tripped.
  return hasBlockingFindings(results) ? 1 : 0;
}
