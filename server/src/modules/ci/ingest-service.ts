import { CiResultArtifact, type CiRunStatus } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { parseRepoRef } from './helpers.js';
import { ARTIFACT_NAME, MAX_RUNS_PER_PASS, WORKFLOW_FILE } from './constants.js';
import { CiRepository } from './repository.js';
import type { ActionsClient, CiInstallationRow } from './types.js';
import * as ingestRegistry from './ingest-registry.js';
import type { Logger } from './export-service.js';

export interface IngestFailure {
  repo: string;
  reason: string;
}

/** Returned by `POST /ci-runs/refresh` (`CiRefreshSummary`, declared locally
 *  in `routes.ts` — see D5's "contract + transport-only extras" pattern). */
export interface IngestSummary {
  installationsChecked: number;
  runsExamined: number;
  artifactsValid: number;
  artifactsInvalid: number;
  artifactsMissing: number;
  skipped: number;
  failures: IngestFailure[];
}

function emptySummary(): IngestSummary {
  return {
    installationsChecked: 0,
    runsExamined: 0,
    artifactsValid: 0,
    artifactsInvalid: 0,
    artifactsMissing: 0,
    skipped: 0,
    failures: [],
  };
}

/**
 * CiIngestService — the AC-43…AC-53 ingest pass: for every `gha`
 * installation in the workspace, lists recent `devdigest-review.yml` runs,
 * derives a status per D6, resolves the artifact per AC-46/AC-50/AC-51, and
 * writes the paired `ci_runs`/`agent_runs` rows (AC-47/AC-48). An error on
 * one installation never touches another installation's rows (AC-52); a
 * concurrent pass for the same repo is skipped, not queued (AC-53).
 *
 * Onion boundary: no `drizzle-orm`/`db/schema`/`fastify` import here — DB
 * access goes through `CiRepository`.
 */
export class CiIngestService {
  private repo: CiRepository;

  constructor(private container: Container) {
    this.repo = new CiRepository(container.db);
  }

  async refresh(workspaceId: string, logger?: Logger): Promise<IngestSummary> {
    const summary = emptySummary();

    const installations = (await this.repo.listInstallations(workspaceId)).filter(
      (installation) => installation.target_type === 'gha',
    );
    if (installations.length === 0) return summary;

    const actions = await this.container.githubActions();

    for (const installation of installations) {
      // AC-53 — a second pass for the same repo while one is in flight is
      // skipped outright, not queued.
      if (!ingestRegistry.tryAcquire(installation.repo)) {
        summary.skipped += 1;
        continue;
      }
      summary.installationsChecked += 1;
      try {
        await this.refreshInstallation(installation, actions, summary);
      } catch (err) {
        // AC-52 — an API error/rate limit for ONE installation leaves every
        // other installation's (and this one's already-persisted) rows
        // untouched; nothing in this path deletes or zeroes anything.
        const reason = err instanceof Error ? err.message : String(err);
        summary.failures.push({ repo: installation.repo, reason });
        logger?.warn({ repo: installation.repo, reason }, 'ci ingest: installation failed');
      } finally {
        ingestRegistry.release(installation.repo);
      }
    }

    logger?.info(summary, 'ci ingest: pass complete');
    return summary;
  }

  private async refreshInstallation(
    installation: CiInstallationRow,
    actions: ActionsClient,
    summary: IngestSummary,
  ): Promise<void> {
    const ref = parseRepoRef(installation.repo);
    const runs = await actions.listWorkflowRuns(ref, WORKFLOW_FILE, MAX_RUNS_PER_PASS);
    const existingKeys = await this.repo.existingRunKeys(installation.id);

    for (const run of runs) {
      summary.runsExamined += 1;

      // D7 — skip-list: a run already stored with a TERMINAL status needs no
      // re-fetch. Only `running` rows (or a run never seen before) are
      // worth re-examining — this is what keeps a steady-state pass to ~1
      // request instead of 3+ per run.
      const existingStatus = existingKeys.get(run.id);
      if (existingStatus && existingStatus !== 'running') continue;

      if (run.status !== 'completed') {
        await this.repo.upsertRunWithAgentRun({
          ciInstallationId: installation.id,
          workflowRunId: run.id,
          status: 'running',
          prNumber: run.pull_requests?.[0]?.number ?? null,
          ranAt: run.run_started_at ? new Date(run.run_started_at) : null,
          findingsCount: null,
          costUsd: null,
          githubUrl: run.html_url,
          durationMs: null,
        });
        continue;
      }

      // D6 — a skipped/cancelled fork job is not a review; recording it as
      // `failed` would make every fork PR look like an infra failure.
      if (run.conclusion === 'skipped' || run.conclusion === 'cancelled') continue;

      const artifacts = await actions.listRunArtifacts(ref, run.id);
      const artifactEntry = artifacts.find((a) => a.name === ARTIFACT_NAME && !a.expired);

      let status: CiRunStatus;
      let findingsCount: number | null = null;
      let costUsd: number | null = null;
      let durationMs: number | null = null;
      let prNumberFromArtifact: number | null = null;

      if (!artifactEntry) {
        // Missing OR expired — either way there is no artifact to trust.
        summary.artifactsMissing += 1;
        status = 'failed';
      } else {
        // AC-46 — validate BEFORE any field is persisted or returned.
        const raw = await actions.downloadArtifactJson(ref, artifactEntry.id);
        const parsed = CiResultArtifact.safeParse(raw);
        if (!parsed.success) {
          summary.artifactsInvalid += 1;
          status = 'failed';
        } else {
          summary.artifactsValid += 1;
          findingsCount = parsed.data.findings_count;
          costUsd = parsed.data.cost_usd;
          durationMs = parsed.data.duration_ms ?? null;
          prNumberFromArtifact = parsed.data.pr_number ?? null;
          // A gate-blocked run (conclusion: failure) with a valid artifact
          // and findings is still a SUCCESSFUL review, not an infra failure.
          status = findingsCount > 0 ? 'succeeded' : 'no_findings';
          // Note: `parsed.data.agent` is untrusted text — deliberately never
          // read here (no `ci_runs` column stores it; the run's agent
          // attribution comes only from the installation → agents join).
        }
      }

      // AC-51 — fork runs report an empty `pull_requests[]`; fall back to
      // the artifact's own `pr_number`. AC-50 — `github_url` ALWAYS comes
      // from the run object, never the artifact, even when the artifact
      // contains a URL-shaped field.
      const prNumber = run.pull_requests?.[0]?.number ?? prNumberFromArtifact ?? null;

      await this.repo.upsertRunWithAgentRun({
        ciInstallationId: installation.id,
        workflowRunId: run.id,
        status,
        prNumber,
        ranAt: run.run_started_at ? new Date(run.run_started_at) : null,
        findingsCount,
        costUsd,
        githubUrl: run.html_url,
        durationMs,
      });
    }
  }
}
