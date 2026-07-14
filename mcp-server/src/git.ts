/**
 * `git.ts` — git integration behind a port (mirrors `poll.ts`'s inject-for-
 * testability pattern: there it's `now`/`sleep`, here it's the whole
 * `GitPort`). This keeps CLI orchestration (`cli/review.ts`) unit-testable
 * against a mock `GitPort` with no real shelling out.
 *
 * Security (per `security` skill): the shell adapter uses `execFile('git',
 * args, ...)` — an array of args, never a shell string — so there is no shell
 * interpolation / command-injection sink here, unlike `exec(cmd: string)`.
 */

import { execFile } from 'node:child_process';

/** The three named review-diff boundaries (spec §0). Only `working` ships in v1. */
export type ReviewMode = 'working' | 'staged' | 'branch';

/**
 * Table-driven dispatch: the `git diff` args for each mode, or `null` for a
 * mode that is named but not yet implemented (`branch` — "committed-but-
 * unpushed" needs a `git diff @{push}`-style invocation deferred to a later
 * step; see spec §5). Keeps adding `branch` later a small addition, not a
 * rewrite.
 */
export const MODE_DIFF_ARGS: Record<ReviewMode, string[] | null> = {
  working: ['diff'],
  staged: ['diff', '--cached'],
  branch: null,
};

/** The injectable git port — the whole surface `cli/review.ts` depends on. */
export interface GitPort {
  diff(mode: ReviewMode): Promise<string>;
  remoteUrl(): Promise<string>;
}

const MAX_BUFFER = 10 * 1024 * 1024; // 10 MiB — generous for a working-tree diff

/**
 * The real shell adapter. `cwd` is the directory the CLI was invoked from
 * (the developer's working copy).
 */
export function createGitPort(cwd: string): GitPort {
  function run(args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile('git', args, { cwd, maxBuffer: MAX_BUFFER }, (error, stdout) => {
        if (error) reject(error);
        else resolve(stdout);
      });
    });
  }

  return {
    async diff(mode: ReviewMode): Promise<string> {
      const args = MODE_DIFF_ARGS[mode];
      if (args === null) {
        throw new Error(`--mode ${mode} is not yet implemented`);
      }
      return run(args);
    },

    async remoteUrl(): Promise<string> {
      try {
        const url = await run(['remote', 'get-url', 'origin']);
        return url.trim();
      } catch {
        // Fallback for older git / a remote configured without `remote add`.
        const url = await run(['config', '--get', 'remote.origin.url']);
        return url.trim();
      }
    },
  };
}

const SSH_RE = /^git@[^:]+:([^/]+)\/(.+?)(?:\.git)?\/?$/;
const HTTPS_RE = /^https?:\/\/[^/]+\/([^/]+)\/(.+?)(?:\.git)?\/?$/;

/**
 * Pure parser: `origin` remote URL → `{owner, name}`, or `null` for anything
 * unrecognized. Handles SSH (`git@github.com:owner/name.git`), HTTPS
 * (`https://github.com/owner/name.git`), `.git`-less, and trailing-slash
 * variants. Case-preserving (owner/repo casing is not normalized).
 */
export function parseRemoteUrl(url: string): { owner: string; name: string } | null {
  const trimmed = url.trim();
  if (trimmed === '') return null;

  const match = SSH_RE.exec(trimmed) ?? HTTPS_RE.exec(trimmed);
  if (!match) return null;

  const [, owner, name] = match;
  if (!owner || !name) return null;

  return { owner, name };
}
