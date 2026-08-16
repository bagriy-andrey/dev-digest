/**
 * Export-to-CI (SPEC-04) — path/branch/workflow constants. Pure, zero I/O.
 *
 * `WORKFLOW_JOB_ID`/`WORKFLOW_JOB_NAME` are FIXED constants, never derived
 * from the agent name/slug: a branch-protection "required status check" in
 * the target repo is matched by job NAME, so re-exporting after renaming the
 * agent must never change which check GitHub is waiting on (AC-13).
 */

export const DEVDIGEST_DIR = '.devdigest';
export const MANIFEST_DIR = '.devdigest/agents';
export const SKILLS_DIR = '.devdigest/skills';
export const MEMORY_PATH = '.devdigest/memory.jsonl';
export const RUNNER_PATH = '.devdigest/runner/index.js';
export const WORKFLOW_FILE = 'devdigest-review.yml';
export const WORKFLOW_PATH = '.github/workflows/devdigest-review.yml';

export const CI_BRANCH = 'devdigest/ci';
export const PR_TITLE = 'Add DevDigest CI review';
export const COMMIT_MESSAGE = 'Add DevDigest CI review';

// A branch-protection required check matches by job NAME — these must never
// vary with the agent/slug being exported (AC-13).
export const WORKFLOW_JOB_ID = 'devdigest-review';
export const WORKFLOW_JOB_NAME = 'DevDigest Review';

// Untrusted input allowlist (D9) — `CiExportInput.triggers` is arbitrary
// strings that end up interpolated into a workflow file living in someone
// else's repository; only these three GitHub event types are ever emitted.
export const ALLOWED_TRIGGERS = ['opened', 'synchronize', 'reopened'] as const;
export const DEFAULT_TRIGGERS: string[] = ['opened', 'synchronize'];

export const ARTIFACT_NAME = 'devdigest-result';
export const ARTIFACT_FILE = 'devdigest-result.json';

export const MAX_RUNS_PER_PASS = 20;
export const MAX_MEMORY_ENTRIES = 500;
