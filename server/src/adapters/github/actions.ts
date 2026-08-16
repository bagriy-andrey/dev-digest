import { Octokit } from 'octokit';
import AdmZip from 'adm-zip';
import { withRetry, withTimeout } from '../../platform/resilience.js';
import { ARTIFACT_FILE, WORKFLOW_FILE } from '../../modules/ci/constants.js';
import type {
  ActionsClient,
  ArtifactSummary,
  RepoRef,
  WorkflowRunSummary,
} from '../../modules/ci/types.js';

const TIMEOUT = 30_000;

/**
 * D2 — `ActionsClient` over Octokit REST. Module-local port (see
 * `modules/ci/types.ts`), NOT part of the vendored `GitHubClient` (that port
 * also feeds `reviewer-core`/`agent-runner`; widening it for two read-only
 * ingest methods would ripple into both).
 */
export class OctokitActionsClient implements ActionsClient {
  private octokit: Octokit;

  constructor(token: string) {
    this.octokit = new Octokit({ auth: token });
  }

  async listWorkflowRuns(
    repo: RepoRef,
    workflowFile: string,
    limit: number,
  ): Promise<WorkflowRunSummary[]> {
    return withRetry(() =>
      withTimeout(
        (async () => {
          const res = await this.octokit.rest.actions.listWorkflowRuns({
            owner: repo.owner,
            repo: repo.name,
            workflow_id: workflowFile || WORKFLOW_FILE,
            per_page: limit,
          });
          return res.data.workflow_runs.map((run) => ({
            id: String(run.id),
            html_url: run.html_url,
            status: run.status ?? 'unknown',
            conclusion: run.conclusion ?? null,
            head_branch: run.head_branch ?? null,
            run_started_at: run.run_started_at ?? null,
            // Empty/absent for fork PRs (AC-51) — never assume `[0]` exists.
            pull_requests: (run.pull_requests ?? []).map((pr) => ({ number: pr.number })),
          }));
        })(),
        TIMEOUT,
      ),
    );
  }

  async listRunArtifacts(repo: RepoRef, runId: string): Promise<ArtifactSummary[]> {
    return withRetry(() =>
      withTimeout(
        (async () => {
          const res = await this.octokit.rest.actions.listWorkflowRunArtifacts({
            owner: repo.owner,
            repo: repo.name,
            run_id: Number(runId),
          });
          return res.data.artifacts.map((a) => ({
            id: String(a.id),
            name: a.name,
            expired: Boolean(a.expired),
          }));
        })(),
        TIMEOUT,
      ),
    );
  }

  /**
   * Downloads the artifact ZIP (octokit follows the API's 302 to the signed,
   * short-lived download URL), unzips with `adm-zip`, and `JSON.parse`s the
   * `devdigest-result.json` entry. Returns `null` on ANY failure (missing
   * entry, malformed zip, bad JSON) — never throws a parse error up as an
   * infra failure; the caller re-validates through `CiResultArtifact.safeParse`
   * before persisting anything (AC-46).
   */
  async downloadArtifactJson(repo: RepoRef, artifactId: string): Promise<unknown | null> {
    try {
      const res = await withRetry(() =>
        withTimeout(
          this.octokit.rest.actions.downloadArtifact({
            owner: repo.owner,
            repo: repo.name,
            artifact_id: Number(artifactId),
            archive_format: 'zip',
          }),
          TIMEOUT,
        ),
      );
      const buffer = Buffer.from(res.data as ArrayBuffer);
      const zip = new AdmZip(buffer);
      const entry = zip.getEntry(ARTIFACT_FILE);
      if (!entry) return null;
      const text = entry.getData().toString('utf8');
      return JSON.parse(text);
    } catch {
      return null;
    }
  }
}
