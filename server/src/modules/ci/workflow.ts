import {
  ARTIFACT_FILE,
  ARTIFACT_NAME,
  RUNNER_PATH,
  WORKFLOW_JOB_ID,
  WORKFLOW_JOB_NAME,
} from './constants.js';

/**
 * Renders the GitHub Actions workflow YAML embedded in every Export-to-CI
 * bundle (AC-8…AC-17). Pure string template — no I/O, no YAML library
 * needed here (unlike the manifest, this file is authored/controlled
 * entirely by DevDigest, never round-tripped back through a parser).
 *
 * Callers MUST pass an already-sanitized `triggers` array (see
 * `helpers.ts::sanitizeTriggers`, D9) — this function does no filtering of
 * its own, it only formats what it's given.
 *
 * Security-relevant invariants (do not change without re-reading SPEC-04):
 * - trigger is `pull_request`, NEVER `pull_request_target` (AC-11) — the
 *   latter runs with base-branch secrets against untrusted fork code.
 * - `permissions:` is FIXED — `contents: read` / `pull-requests: write` /
 *   `issues: write` — for every `post_as` value; declaring any permissions
 *   key sets every unlisted scope to `none`, so this block IS the
 *   deny-by-default boundary (AC-10). Never branch this on `postAs`.
 * - the job is skipped outright for PRs from an external repo (AC-12): such
 *   PRs get no repository secrets, so running it would hard-fail on an empty
 *   `OPENROUTER_API_KEY` and look like a blocking verdict instead of an
 *   observable skip. This is deliberately `head.repo.full_name !=
 *   base.repo.full_name`, NOT `head.repo.fork == true` — the latter is a
 *   property of the repo itself (was it ever created via Fork?), so it's
 *   true for every PR — including same-repo branch-to-branch PRs — whenever
 *   the installing repo is itself a fork of some upstream. Those PRs run
 *   inside the installing repo and DO have its secrets; only a PR whose head
 *   lives in a genuinely different repository lacks them.
 * - job id + `name:` are the fixed `WORKFLOW_JOB_ID`/`WORKFLOW_JOB_NAME`
 *   constants, never derived from the agent/slug (AC-13) — a branch
 *   protection required check is matched by job NAME.
 * - no `uses:` for the review itself (the runner bundle travels in the PR,
 *   AC-8/AC-17) and no `setup-node` step (ubuntu-latest ships Node ≥20 and
 *   the bundle is dependency-free).
 * - the upload step carries `if: always()` — a gate-blocked run exits 1 and
 *   MUST still upload its artifact (AC-15).
 */
export interface RenderWorkflowInput {
  /** Already-sanitized GitHub event types, canonical order (D9). */
  triggers: string[];
  /** The wizard's "post results as" choice — becomes `DEVDIGEST_POST_AS` (AC-14). */
  postAs: string;
}

export function renderWorkflow({ triggers, postAs }: RenderWorkflowInput): string {
  const typesLine = triggers.join(', ');
  return `name: DevDigest Review

on:
  pull_request:
    types: [${typesLine}]

# Declaring any permissions key sets every unlisted scope to none — this block
# IS the deny-by-default boundary (AC-10). Fixed, never branched on post_as.
permissions:
  contents: read
  pull-requests: write
  issues: write

jobs:
  ${WORKFLOW_JOB_ID}:
    name: ${WORKFLOW_JOB_NAME}
    # Fork PRs receive no repository secrets; run the job at all and it would
    # hard-fail on an empty OPENROUTER_API_KEY and look like a blocking verdict.
    # Skip explicitly so it is observable AS a skip (AC-12).
    if: github.event.pull_request.head.repo.full_name == github.event.pull_request.base.repo.full_name
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Run DevDigest review
        env:
          OPENROUTER_API_KEY: \${{ secrets.OPENROUTER_API_KEY }}
          GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}
          GITHUB_REPOSITORY: \${{ github.repository }}
          PR_NUMBER: \${{ github.event.pull_request.number }}
          DEVDIGEST_POST_AS: ${postAs}
        run: node ${RUNNER_PATH}
      - name: Upload DevDigest result
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: ${ARTIFACT_NAME}
          path: ${ARTIFACT_FILE}
          if-no-files-found: warn
`;
}
