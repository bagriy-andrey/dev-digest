#!/usr/bin/env node
/**
 * `cli.ts` — the `devdigest` CLI bin entry (spec §1.B, Step M4). This is the
 * SECOND entry point in this package (composition root for the CLI, not the
 * stdio MCP server).
 *
 * STDOUT RULE — the opposite of `index.ts`: `index.ts` is the JSON-RPC stdio
 * transport and is stderr-only (a stray stdout write corrupts the protocol
 * stream). `cli.ts` is a normal terminal program: results go to stdout,
 * diagnostics/errors go to stderr. Only this file (and what it calls via the
 * injected `out`/`err` writers) may write to stdout in this package.
 *
 * Argv parsing is hand-rolled (no new dependency — matches the package's
 * zero-extra-deps posture): `devdigest review [--mode <working|staged|branch>]`.
 * Anything else (unknown subcommand, unknown flag, bad mode value) prints
 * usage to stderr and exits 2.
 *
 * Exit-code contract (so this is usable verbatim as a `.git/hooks/pre-push`
 * script later — wiring the hook itself is out of scope):
 *   0 = clean (no blocking findings)
 *   1 = blocking findings (any agent's server-computed `blockers > 0`)
 *   2 = usage error / repo-resolution failure / infra error (network, git, ...)
 */

import { loadConfig } from './config.js';
import { createApiClient } from './api/http-client.js';
import { createGitPort, type ReviewMode } from './git.js';
import { runReview } from './cli/review.js';

const VALID_MODES: readonly ReviewMode[] = ['working', 'staged', 'branch'];

const USAGE = `Usage: devdigest review [--mode <working|staged|branch>]

  review        Review the local diff and print grouped findings.
    --mode      Diff boundary to review (default: working).
                 working = git diff (working tree vs index)
                 staged  = git diff --cached
                 branch  = committed-but-unpushed (not yet implemented)

Exit codes: 0 = clean, 1 = blocking findings, 2 = usage/resolution/infra error.`;

interface ParsedArgs {
  mode: ReviewMode;
}

/**
 * Minimal hand-rolled argv parse. Returns `null` (rather than throwing) for
 * any unknown subcommand/flag/mode so the caller can print usage + exit 2
 * uniformly.
 */
function parseArgs(argv: string[]): ParsedArgs | null {
  const [subcommand, ...rest] = argv;
  if (subcommand !== 'review') return null;

  let mode: ReviewMode = 'working';

  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (arg === '--mode') {
      const value = rest[i + 1];
      if (!value || !(VALID_MODES as readonly string[]).includes(value)) return null;
      mode = value as ReviewMode;
      i += 1;
    } else {
      return null;
    }
  }

  return { mode };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args) {
    process.stderr.write(USAGE + '\n');
    process.exit(2);
  }

  const config = loadConfig();
  const api = createApiClient(config);
  const git = createGitPort(process.cwd());

  const code = await runReview({
    api,
    git,
    mode: args.mode,
    out: (s: string) => process.stdout.write(s + '\n'),
    err: (s: string) => process.stderr.write(s + '\n'),
  });
  process.exit(code);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(message + '\n');
  process.exit(2);
});
