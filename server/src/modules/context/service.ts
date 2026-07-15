import path from 'node:path';
import type {
  ContextDoc,
  ContextIndexStatus,
  ContextAttachment,
  ContextFileContent,
  ContextSourceType,
  RepoRef,
} from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import type { AgentRow } from '../../db/rows.js';
import { NotFoundError, ValidationError } from '../../platform/errors.js';
import { RepoRepository } from '../repos/repository.js';
import { SkillsRepository } from '../skills/repository.js';
import { ContextRepository } from './repository.js';
import { discoverDocs } from './discovery.js';
import { DEFAULT_CONTEXT_FOLDERS } from './constants.js';

/** Minimal structured logger (pino-compatible), same shape used across the
 *  other services (`IntentService`/`BlastService`/`run-executor.ts`). */
export type Logger = {
  info: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
};

export interface EffectiveSpecsResult {
  /** Ordered, dedup'd, "`Path: X\n\n<raw text>`"-formatted doc bodies — ready to feed reviewer-core's `specs`. */
  specs: string[];
  /** Repo-relative paths actually read (AC-21 "Specs read"). */
  read: string[];
  /** Repo-relative paths that were attached but could not be read (AC-19). */
  skipped: string[];
}

/**
 * Reject any path that is empty, absolute, or contains a `..`/`.` traversal
 * segment. This is the baseline safety check shared by every path-taking
 * entry point in this module (`getFileContent`'s query param AND the
 * run-time `resolveEffectiveSpecs` reader) — see the `security` skill's
 * path-traversal guidance. `getFileContent` layers an ADDITIONAL
 * discovered-set membership check on top (it is a direct HTTP sink).
 *
 * Pure — exported for hermetic unit testing without a DB (`test/context.test.ts`).
 */
export function isSafeRelativePath(candidate: string): boolean {
  if (!candidate || candidate.startsWith('/') || candidate.includes('\\') || candidate.includes('\0')) {
    return false;
  }
  const normalized = path.posix.normalize(candidate);
  if (normalized !== candidate) return false;
  return !normalized.split('/').some((segment) => segment === '..' || segment === '.');
}

/**
 * AC-14/AC-15: union an agent's direct-attach paths (in their own order)
 * with each enabled linked skill's paths (in skill order, skills themselves
 * in the agent's linked-skill order), deduped by path — a path already seen
 * (from an earlier group) is never re-added, so the agent's own direct
 * position always wins over any skill-derived position.
 *
 * Pure — exported for hermetic unit testing without a DB.
 */
export function dedupeOrderedPaths(directPaths: string[], skillPathGroups: string[][]): string[] {
  const ordered: string[] = [];
  const seen = new Set<string>();
  const add = (p: string) => {
    if (seen.has(p)) return;
    seen.add(p);
    ordered.push(p);
  };
  for (const p of directPaths) add(p);
  for (const group of skillPathGroups) {
    for (const p of group) add(p);
  }
  return ordered;
}

/** AC-8: `round(usedBy / totalAgents * 100)`, 0 when the workspace has no agents. Pure. */
export function computeCoverage(usedBy: number, totalAgents: number): number {
  return totalAgents === 0 ? 0 : Math.round((usedBy / totalAgents) * 100);
}

/**
 * `ContextService(container)` — Project Context module (SPEC-01). NOT added
 * to the DI container (matches the `SkillsService` precedent — instantiated
 * directly by routes and, in step 5, by `run-executor.ts`).
 */
export class ContextService {
  private repo: ContextRepository;
  private repos: RepoRepository;
  private skillsRepo: SkillsRepository;

  constructor(private container: Container) {
    this.repo = new ContextRepository(container.db);
    this.repos = new RepoRepository(container.db);
    this.skillsRepo = new SkillsRepository(container.db);
  }

  private async resolveRepoRef(workspaceId: string, repoId: string): Promise<RepoRef | null> {
    const repo = await this.repos.getById(workspaceId, repoId);
    return repo ? { owner: repo.owner, name: repo.name } : null;
  }

  private async discoverForRepo(ref: RepoRef) {
    return discoverDocs(this.container.git.clonePathFor(ref), DEFAULT_CONTEXT_FOLDERS);
  }

  // ---- Project Context page (Screen 1) ---------------------------------

  /** Discovered docs + their "Used by N agents" / COVERAGE metrics. Degrades to `[]` if the repo/clone is missing. */
  async listForRepo(workspaceId: string, repoId: string): Promise<ContextDoc[]> {
    const ref = await this.resolveRepoRef(workspaceId, repoId);
    if (!ref) return [];

    const docs = await this.discoverForRepo(ref);
    if (docs.length === 0) return [];

    const { usedBy, totalAgents } = await this.computeUsage(workspaceId);

    return docs.map((d) => {
      const used = usedBy.get(d.path)?.size ?? 0;
      return {
        path: d.path,
        source_type: d.source_type as ContextSourceType,
        size: d.size,
        headings: d.headings,
        used_by: used,
        coverage: computeCoverage(used, totalAgents),
      };
    });
  }

  /**
   * View-only Preview fetch. This is a path-traversal SINK (the path comes
   * from a client query param) — the guard runs FIRST, before any read:
   * reject unsafe syntax, then confirm the path is a member of the CURRENT
   * discovered set, only then read.
   */
  async getFileContent(workspaceId: string, repoId: string, requestedPath: string): Promise<ContextFileContent> {
    if (!isSafeRelativePath(requestedPath)) {
      throw new ValidationError('Invalid path');
    }

    const ref = await this.resolveRepoRef(workspaceId, repoId);
    if (!ref) throw new NotFoundError('Repo not found');

    const docs = await this.discoverForRepo(ref);
    if (!docs.some((d) => d.path === requestedPath)) {
      throw new NotFoundError('Doc not found');
    }

    const content = await this.container.git.readFile(ref, requestedPath);
    return { path: requestedPath, content };
  }

  /** Re-run discovery and persist the footer scan state (AC-4). */
  async reindex(workspaceId: string, repoId: string): Promise<ContextIndexStatus> {
    const ref = await this.resolveRepoRef(workspaceId, repoId);
    if (!ref) throw new NotFoundError('Repo not found');

    const docs = await this.discoverForRepo(ref);
    const files = docs.length;
    const chunks = docs.reduce((sum, d) => sum + d.headings, 0);
    const scannedAt = new Date();

    await this.repo.upsertScanState(repoId, { files, chunks, scannedAt });

    return { files, chunks, scanned_at: scannedAt.toISOString() };
  }

  // ---- Agent Context tab (Screen 2) ------------------------------------

  async getAgentDocs(workspaceId: string, agentId: string): Promise<ContextAttachment[]> {
    const agent = await this.container.agentsRepo.getById(workspaceId, agentId);
    if (!agent) throw new NotFoundError('Agent not found');
    return this.repo.getAgentDocs(agentId);
  }

  async setAgentDocs(workspaceId: string, agentId: string, paths: string[]): Promise<ContextAttachment[]> {
    const agent = await this.container.agentsRepo.getById(workspaceId, agentId);
    if (!agent) throw new NotFoundError('Agent not found');
    await this.repo.setAgentDocs(agentId, paths);
    return this.repo.getAgentDocs(agentId);
  }

  // ---- Skill Context tab (Screen 3) ------------------------------------

  async getSkillDocs(workspaceId: string, skillId: string): Promise<ContextAttachment[]> {
    const skill = await this.skillsRepo.getById(workspaceId, skillId);
    if (!skill) throw new NotFoundError('Skill not found');
    return this.repo.getSkillDocs(skillId);
  }

  async setSkillDocs(workspaceId: string, skillId: string, paths: string[]): Promise<ContextAttachment[]> {
    const skill = await this.skillsRepo.getById(workspaceId, skillId);
    if (!skill) throw new NotFoundError('Skill not found');
    await this.repo.setSkillDocs(skillId, paths);
    return this.repo.getSkillDocs(skillId);
  }

  // ---- metrics (AC-7 / AC-8) --------------------------------------------

  /**
   * `usedBy`: for every doc path, the set of agent ids whose EFFECTIVE
   * attached-doc set includes it (direct attach OR an enabled linked
   * skill's docs — mirrors `resolveEffectiveSpecs`'s union rule, minus the
   * ordering/dedup-position concern which doesn't matter for a membership
   * count). `totalAgents` = every agent in the workspace, enabled or not
   * (COVERAGE denominator — see spec's resolved clarification).
   */
  private async computeUsage(
    workspaceId: string,
  ): Promise<{ usedBy: Map<string, Set<string>>; totalAgents: number }> {
    const agents = await this.container.agentsRepo.list(workspaceId);
    const [agentDocs, skillDocs] = await Promise.all([
      this.repo.allAgentDocs(workspaceId),
      this.repo.allSkillDocs(workspaceId),
    ]);

    const usedBy = new Map<string, Set<string>>();
    const markUsed = (docPath: string, agentId: string) => {
      const set = usedBy.get(docPath);
      if (set) set.add(agentId);
      else usedBy.set(docPath, new Set([agentId]));
    };

    for (const agent of agents) {
      const direct = agentDocs.get(agent.id) ?? [];
      const linked = await this.container.agentsRepo.linkedSkills(agent.id);
      const viaSkills = linked
        .filter((l) => l.enabled && l.skill.enabled)
        .flatMap((l) => skillDocs.get(l.skill.id) ?? []);

      const effective = new Set([...direct, ...viaSkills]);
      for (const docPath of effective) markUsed(docPath, agent.id);
    }

    return { usedBy, totalAgents: agents.length };
  }

  // ---- run-time injection (used by run-executor, step 5) ----------------

  /**
   * Resolve an agent's effective attached-doc set (AC-14/AC-15: direct docs
   * first in their own order, then each enabled linked skill's docs in skill
   * order, deduped by path with agent-direct position winning) and read each
   * doc's CURRENT content fresh from `ref`'s clone. A doc that fails to read
   * (deleted/renamed upstream) is recorded in `skipped` and never fails the
   * run (AC-19).
   */
  async resolveEffectiveSpecs(ref: RepoRef, agent: AgentRow, log?: Logger): Promise<EffectiveSpecsResult> {
    const direct = await this.repo.getAgentDocs(agent.id);
    const linked = await this.container.agentsRepo.linkedSkills(agent.id);
    const enabledSkills = linked.filter((l) => l.enabled && l.skill.enabled);
    const skillDocGroups = await Promise.all(
      enabledSkills.map((l) => this.repo.getSkillDocs(l.skill.id)),
    );

    const orderedPaths = dedupeOrderedPaths(
      direct.map((d) => d.path),
      skillDocGroups.map((group) => group.map((d) => d.path)),
    );

    const specs: string[] = [];
    const read: string[] = [];
    const skipped: string[] = [];

    for (const docPath of orderedPaths) {
      if (!isSafeRelativePath(docPath)) {
        skipped.push(docPath);
        log?.warn({ path: docPath }, 'Project context: rejected unsafe path');
        continue;
      }
      try {
        const content = await this.container.git.readFile(ref, docPath);
        specs.push(`Path: ${docPath}\n\n${content}`);
        read.push(docPath);
      } catch (err) {
        skipped.push(docPath);
        log?.warn({ path: docPath, err: (err as Error).message }, 'Project context: doc unreadable, skipping');
      }
    }

    return { specs, read, skipped };
  }
}
