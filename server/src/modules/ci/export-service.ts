import type { Container } from '../../platform/container.js';
import type { CiExportInput, CiExport, CiInstallation } from '@devdigest/shared';
import { NotFoundError, ValidationError, ExternalServiceError } from '../../platform/errors.js';
import type { CiInstallationRow, CiRunRow } from './types.js';
import {
  parseRepoRef,
  sanitizeTriggers,
  slugify,
  slugifyUnique,
  buildManifest,
  buildBundle,
  applyFileOverrides,
} from './helpers.js';
import { renderWorkflow } from './workflow.js';
import { readRunnerBundle } from './runner-bundle.js';
import { CI_BRANCH, PR_TITLE, COMMIT_MESSAGE, MAX_MEMORY_ENTRIES } from './constants.js';
import { CiRepository } from './repository.js';

/** Minimal pino-compatible logger shape (mirrors the `req.log` pattern used
 *  elsewhere in this repo — `container` has no logger of its own). */
export interface Logger {
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
}

const PR_BODY =
  'Adds a GitHub Actions workflow that runs the DevDigest review agent on every ' +
  'pull request against this repository. See `.devdigest/agents/` for the exported ' +
  'agent configuration and `.devdigest/skills/` for its linked skills.';

/**
 * CiExportService — the AC-18…AC-24 export flow: build the CI bundle
 * (manifest + skills + memory + runner + workflow) for one agent/repo pair,
 * then either return it as a Preview (`action: 'files'`, zero GitHub calls,
 * nothing persisted — D4) or commit it and open/reuse a PR
 * (`action: 'open_pr'`, only persisting the installation AFTER the GitHub
 * write succeeds — AC-22/AC-23).
 *
 * Onion boundary: no `drizzle-orm`/`db/schema`/`fastify` import here — DB
 * access goes through `CiRepository`, agents are reached only via
 * `container.agentsRepo`.
 */
export class CiExportService {
  private repo: CiRepository;

  constructor(private container: Container) {
    this.repo = new CiRepository(container.db);
  }

  async export(
    workspaceId: string,
    agentId: string,
    input: CiExportInput,
    logger?: Logger,
  ): Promise<CiExport> {
    // AC-24: an agent id outside this workspace is simply not found — this IS
    // the workspace-scoping check for the export path.
    const agent = await this.container.agentsRepo.getById(workspaceId, agentId);
    if (!agent) throw new NotFoundError('Agent not found');

    // AC-26 server half: only GitHub Actions is actually wired today.
    if (input.target !== 'gha') {
      throw new ValidationError(
        `CI target "${input.target}" is not available yet — only GitHub Actions ("gha") can be exported.`,
        { target: input.target },
      );
    }

    const ref = parseRepoRef(input.repo);

    // Two-flag skill filter (server/insights.md): a link can be disabled
    // per-agent, and a skill can be disabled globally — both gate inclusion.
    const links = (await this.container.agentsRepo.linkedSkills(agentId)).filter(
      (link) => link.enabled && link.skill.enabled,
    );
    const slugs = slugifyUnique(links.map((link) => link.skill.name));
    const skillFiles = links.map((link, i) => ({ slug: slugs[i]!, body: link.skill.body }));

    const manifest = buildManifest(
      {
        name: agent.name,
        provider: agent.provider,
        model: agent.model,
        systemPrompt: agent.systemPrompt,
        strategy: agent.strategy,
        ciFailOn: agent.ciFailOn,
      },
      slugs,
    );
    const manifestSlug = slugify(agent.name);

    const memoryRows = await this.repo.listMemory(workspaceId, MAX_MEMORY_ENTRIES);
    const runnerBundle = readRunnerBundle(this.container.config);
    const workflowYaml = renderWorkflow({
      triggers: sanitizeTriggers(input.triggers),
      postAs: input.post_as,
    });

    const generated = buildBundle({
      manifest,
      manifestSlug,
      skills: skillFiles,
      memoryRows,
      runnerBundle,
      workflowYaml,
    });
    const files = applyFileOverrides(generated, input.files);

    if (input.action === 'files') {
      const installation = await this.previewInstallation(workspaceId, agentId, input);
      logger?.info(
        {
          agentId,
          repo: input.repo,
          target: input.target,
          action: input.action,
          branch: CI_BRANCH,
          prUrl: null,
          fileCount: files.length,
        },
        'ci export: preview (no GitHub calls)',
      );
      return { installation, files, pr_url: null };
    }

    // action === 'open_pr' (AC-19/AC-20): commit → find an existing open PR →
    // open one only if none exists. Only after the GitHub write succeeds do
    // we persist the installation (AC-22/AC-23 — never a partial install).
    const github = await this.container.github();
    let prUrl: string;
    try {
      await github.commitFiles(ref, {
        branch: CI_BRANCH,
        base: input.base,
        files,
        message: COMMIT_MESSAGE,
      });
      const existingPr = await github.findOpenPr(ref, CI_BRANCH);
      prUrl = existingPr
        ? existingPr.url
        : (
            await github.openPullRequest(ref, {
              title: PR_TITLE,
              head: CI_BRANCH,
              base: input.base,
              body: PR_BODY,
            })
          ).url;
    } catch (err) {
      throw mapGitHubError(err);
    }

    const installation = await this.repo.upsertInstallation(agentId, input.repo, input.target);

    // Never a token or file body in the log line (spec §Observability, AC-6).
    logger?.info(
      {
        agentId,
        repo: input.repo,
        target: input.target,
        action: input.action,
        branch: CI_BRANCH,
        prUrl,
        fileCount: files.length,
      },
      'ci export: opened/reused PR',
    );
    return { installation, files, pr_url: prUrl };
  }

  /** `GET /ci-installations` — AC-26a/AC-36/AC-37. Thin pass-through to
   *  `CiRepository`, workspace-scoped (optionally one agent's). */
  async listInstallations(workspaceId: string, agentId?: string): Promise<CiInstallationRow[]> {
    return this.repo.listInstallations(workspaceId, agentId);
  }

  /** `GET /ci-runs` — AC-40/AC-41. Thin pass-through to `CiRepository`. */
  async listRuns(workspaceId: string, limit: number): Promise<CiRunRow[]> {
    return this.repo.listRuns(workspaceId, limit);
  }

  /**
   * D4 — a Preview is not an install: return the EXISTING installation row
   * if one exists for this (agent, repo, target), otherwise a transient,
   * never-persisted stand-in (`id: ''`). Callers must never treat a preview
   * response's `installation.id` as a real row.
   */
  private async previewInstallation(
    workspaceId: string,
    agentId: string,
    input: CiExportInput,
  ): Promise<CiInstallation> {
    const existing = await this.repo.findInstallation(workspaceId, agentId, input.repo, input.target);
    if (existing) return existing;
    return {
      id: '',
      agent_id: agentId,
      repo: input.repo,
      target_type: input.target,
      installed_at: new Date().toISOString(),
    };
  }
}

/**
 * AC-23 — GitHub write failures are always wrapped in `ExternalServiceError`
 * (preserving GitHub's own message), with an extra sentence naming the
 * missing `workflow` scope / *Workflows: write* permission when the failure
 * looks like the classic "refusing to allow a Personal Access Token / GitHub
 * App to create or update workflow files" rejection — distinct from a plain
 * contents-write failure.
 */
function mapGitHubError(err: unknown): ExternalServiceError {
  const message = err instanceof Error ? err.message : String(err);
  if (/workflow|Workflows: write|refusing to allow a (Personal Access Token|GitHub App)/i.test(message)) {
    return new ExternalServiceError(
      'GitHub rejected the write to .github/workflows/ — the configured token is missing the ' +
        '"workflow" scope (classic PAT) or "Workflows: write" permission (fine-grained PAT). ' +
        message,
      { githubMessage: message },
    );
  }
  return new ExternalServiceError(`GitHub export failed: ${message}`, { githubMessage: message });
}
