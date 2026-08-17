import type { CiTarget, CiRunStatus } from '@devdigest/shared';

/**
 * Module-local types for `modules/ci/**` — port interfaces (D2) + the row
 * shapes `repository.ts` returns. Kept out of the vendored contract because
 * they either (a) are infrastructure-only ports never serialized on the wire
 * (`ActionsClient`, `WorkflowRunSummary`, `ArtifactSummary`), or (b) extend a
 * frozen contract with transport-only fields at the repository/route boundary
 * (D5) rather than widening `CiInstallation`/`CiRun` themselves.
 */

/** A parsed "owner/name" repo reference (see `helpers.ts#parseRepoRef`, D9). */
export interface RepoRef {
  owner: string;
  name: string;
}

/**
 * D2 — the GitHub Actions API surface CI ingest needs, behind a MODULE-LOCAL
 * port rather than an extension of the vendored `GitHubClient` (which also
 * feeds `reviewer-core` and the shipped `agent-runner` bundle — widening it
 * for two read-only methods used by exactly this module would ripple into
 * both). Implemented by `adapters/github/actions.ts` (octokit + adm-zip);
 * the container exposes it as `githubActions()` with a
 * `ContainerOverrides.githubActions` test-injection hook.
 */
export interface ActionsClient {
  listWorkflowRuns(
    repo: RepoRef,
    workflowFile: string,
    limit: number,
  ): Promise<WorkflowRunSummary[]>;
  listRunArtifacts(repo: RepoRef, runId: string): Promise<ArtifactSummary[]>;
  /** Downloads + unzips the artifact and JSON.parses `devdigest-result.json`.
   *  Returns `null` on any failure (missing entry, malformed zip, bad JSON) —
   *  never throws a parse error up as an infra failure (AC-46 is enforced by
   *  the caller re-validating this through `CiResultArtifact.safeParse`). */
  downloadArtifactJson(repo: RepoRef, artifactId: string): Promise<unknown | null>;
}

/** One workflow run, as reported by `GET /actions/workflows/:file/runs`. */
export interface WorkflowRunSummary {
  id: string;
  html_url: string;
  status: string;
  conclusion: string | null;
  head_branch: string | null;
  run_started_at: string | null;
  /** Empty/absent for fork PRs (AC-51) — never assume `[0]` exists. */
  pull_requests?: { number: number }[];
}

/** One artifact entry, as reported by `GET /actions/runs/:id/artifacts`. */
export interface ArtifactSummary {
  id: string;
  name: string;
  expired: boolean;
}

/** A memory row projected for `.devdigest/memory.jsonl` (D10) — content-only,
 *  the `embedding` vector is never selected/serialized. */
export interface MemoryEntry {
  scope: string;
  kind: string;
  content: string;
  confidence: number | null;
  created_at: string;
}

/**
 * `repository.listInstallations` row (D5): `CiInstallation` plus the agent's
 * display name and its most recent run (nullable — a fresh install has none).
 */
export interface CiInstallationRow {
  id: string;
  agent_id: string;
  agent_name: string | null;
  repo: string;
  target_type: CiTarget;
  installed_at: string;
  latest_run: CiRunRow | null;
}

/** `repository.listRuns` row (D5): `CiRun` plus the installation's `repo`. */
export interface CiRunRow {
  id: string;
  ci_installation_id: string | null;
  pr_number: number | null;
  ran_at: string | null;
  status: CiRunStatus | string | null;
  findings_count: number | null;
  cost_usd: number | null;
  github_url: string | null;
  source: string | null;
  agent: string | null;
  duration_s: number | null;
  repo: string | null;
}
