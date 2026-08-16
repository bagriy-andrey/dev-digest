import { and, desc, eq, inArray, isNotNull } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { CiTarget, CiInstallation, CiRunStatus } from '@devdigest/shared';
import type { CiInstallationRow, CiRunRow, MemoryEntry } from './types.js';

/**
 * CiRepository — pure Drizzle data access over `ci_installations` / `ci_runs`
 * (plus the paired `agent_runs` write and a `memory` projection for export).
 * Zero business logic: status derivation (D6), the rate-limit skip-list (D7),
 * and export/ingest orchestration all live in `export-service.ts`/
 * `ingest-service.ts` (Step 3) — this file only ever talks to Drizzle.
 */

// Maps a CI run's own status (persisted verbatim on `ci_runs.status`, D6) onto
// the vocabulary `agent_runs.status` already uses for local runs elsewhere in
// this repo ('running' | 'done' | 'failed' | 'cancelled', see
// `reviews/repository/run.repo.ts`). `no_findings` is still a successful
// review, not a failure, so it maps to 'done'.
function toAgentRunStatus(status: CiRunStatus): 'running' | 'done' | 'failed' {
  if (status === 'running') return 'running';
  if (status === 'failed') return 'failed';
  return 'done';
}

type CiInstallationRowDb = typeof t.ciInstallations.$inferSelect;
type CiRunRowDb = typeof t.ciRuns.$inferSelect;

function toCiInstallation(row: CiInstallationRowDb): CiInstallation {
  return {
    id: row.id,
    agent_id: row.agentId,
    repo: row.repo,
    target_type: row.targetType as CiTarget,
    installed_at: row.installedAt.toISOString(),
  };
}

function toCiRunRow(
  row: CiRunRowDb,
  extra: { agentName: string | null; repo: string | null; durationMs: number | null },
): CiRunRow {
  return {
    id: row.id,
    ci_installation_id: row.ciInstallationId,
    pr_number: row.prNumber,
    ran_at: row.ranAt ? row.ranAt.toISOString() : null,
    status: row.status,
    findings_count: row.findingsCount,
    cost_usd: row.costUsd,
    github_url: row.githubUrl,
    source: row.source,
    agent: extra.agentName,
    duration_s: extra.durationMs != null ? extra.durationMs / 1000 : null,
    repo: extra.repo,
  };
}

/** Input to `upsertRunWithAgentRun` — the AC-47/AC-48 paired write. */
export interface UpsertCiRunInput {
  ciInstallationId: string;
  workflowRunId: string;
  status: CiRunStatus;
  prNumber: number | null;
  ranAt: Date | null;
  findingsCount: number | null;
  costUsd: number | null;
  githubUrl: string | null;
  durationMs: number | null;
}

export class CiRepository {
  constructor(private db: Db) {}

  // ---- ci_installations -----------------------------------------------------

  /** Upsert on (agentId, repo, targetType) — AC-22: re-exporting the same
   *  (agent, repo, target) updates the existing row instead of duplicating. */
  async upsertInstallation(
    agentId: string,
    repo: string,
    targetType: CiTarget,
  ): Promise<CiInstallation> {
    const [row] = await this.db
      .insert(t.ciInstallations)
      .values({ agentId, repo, targetType })
      .onConflictDoUpdate({
        target: [t.ciInstallations.agentId, t.ciInstallations.repo, t.ciInstallations.targetType],
        // Re-installing bumps `installed_at` — the CI tab's "staleNotice" (AC-39)
        // reads this as "when was this repo's config last (re-)exported".
        set: { installedAt: new Date() },
      })
      .returning();
    return toCiInstallation(row!);
  }

  /** Workspace + agent scoped lookup (AC-26a's "already installed?" check and
   *  the export service's D4 preview-vs-persist branch). */
  async findInstallation(
    workspaceId: string,
    agentId: string,
    repo: string,
    targetType: CiTarget,
  ): Promise<CiInstallation | undefined> {
    const [row] = await this.db
      .select({ installation: t.ciInstallations })
      .from(t.ciInstallations)
      .innerJoin(t.agents, eq(t.agents.id, t.ciInstallations.agentId))
      .where(
        and(
          eq(t.agents.workspaceId, workspaceId),
          eq(t.ciInstallations.agentId, agentId),
          eq(t.ciInstallations.repo, repo),
          eq(t.ciInstallations.targetType, targetType),
        ),
      );
    return row ? toCiInstallation(row.installation) : undefined;
  }

  /** Every installation in the workspace (optionally one agent's), each with
   *  the agent's display name and its most recent run (D5, AC-37). */
  async listInstallations(workspaceId: string, agentId?: string): Promise<CiInstallationRow[]> {
    const conditions = [eq(t.agents.workspaceId, workspaceId)];
    if (agentId) conditions.push(eq(t.ciInstallations.agentId, agentId));

    const rows = await this.db
      .select({ installation: t.ciInstallations, agentName: t.agents.name })
      .from(t.ciInstallations)
      .innerJoin(t.agents, eq(t.agents.id, t.ciInstallations.agentId))
      .where(and(...conditions))
      .orderBy(desc(t.ciInstallations.installedAt));

    if (rows.length === 0) return [];

    const latestByInstallation = await this.latestRunsByInstallation(
      rows.map((r) => r.installation.id),
    );

    return rows.map(({ installation, agentName }) => ({
      ...toCiInstallation(installation),
      agent_name: agentName ?? null,
      latest_run: latestByInstallation.get(installation.id) ?? null,
    }));
  }

  // ---- ci_runs ----------------------------------------------------------------

  /** Newest-first, workspace-scoped run list with the joined agent name,
   *  repo (via the installation) and duration (via the `agent_runs` FK) — AC-40. */
  async listRuns(workspaceId: string, limit: number): Promise<CiRunRow[]> {
    const rows = await this.db
      .select({
        run: t.ciRuns,
        agentName: t.agents.name,
        repo: t.ciInstallations.repo,
        durationMs: t.agentRuns.durationMs,
      })
      .from(t.ciRuns)
      .innerJoin(t.ciInstallations, eq(t.ciInstallations.id, t.ciRuns.ciInstallationId))
      .innerJoin(t.agents, eq(t.agents.id, t.ciInstallations.agentId))
      .leftJoin(t.agentRuns, eq(t.agentRuns.id, t.ciRuns.agentRunId))
      .where(eq(t.agents.workspaceId, workspaceId))
      .orderBy(desc(t.ciRuns.ranAt))
      .limit(limit);

    return rows.map(({ run, agentName, repo, durationMs }) =>
      toCiRunRow(run, { agentName, repo, durationMs }),
    );
  }

  /** `workflowRunId -> status` for one installation — D7's rate-limit
   *  skip-list (only `running` rows are worth re-fetching). */
  async existingRunKeys(installationId: string): Promise<Map<string, string>> {
    const rows = await this.db
      .select({ workflowRunId: t.ciRuns.workflowRunId, status: t.ciRuns.status })
      .from(t.ciRuns)
      .where(
        and(eq(t.ciRuns.ciInstallationId, installationId), isNotNull(t.ciRuns.workflowRunId)),
      );
    const map = new Map<string, string>();
    for (const row of rows) {
      if (row.workflowRunId) map.set(row.workflowRunId, row.status ?? '');
    }
    return map;
  }

  /**
   * The AC-47/AC-48 write: upserts `agent_runs` (`source:'ci'`) and `ci_runs`
   * together, inside ONE transaction — never one without the other, in
   * either direction. Re-ingesting the same `(ci_installation_id,
   * workflow_run_id)` UPDATES both rows instead of inserting a duplicate.
   */
  async upsertRunWithAgentRun(input: UpsertCiRunInput): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [installation] = await tx
        .select({
          workspaceId: t.agents.workspaceId,
          agentId: t.agents.id,
          provider: t.agents.provider,
          model: t.agents.model,
        })
        .from(t.ciInstallations)
        .innerJoin(t.agents, eq(t.agents.id, t.ciInstallations.agentId))
        .where(eq(t.ciInstallations.id, input.ciInstallationId));
      if (!installation) {
        throw new Error(
          `upsertRunWithAgentRun: ci_installation ${input.ciInstallationId} not found`,
        );
      }

      const [existingRun] = await tx
        .select({ agentRunId: t.ciRuns.agentRunId })
        .from(t.ciRuns)
        .where(
          and(
            eq(t.ciRuns.ciInstallationId, input.ciInstallationId),
            eq(t.ciRuns.workflowRunId, input.workflowRunId),
          ),
        );

      const agentRunValues = {
        workspaceId: installation.workspaceId,
        agentId: installation.agentId,
        prId: null,
        provider: installation.provider,
        model: installation.model,
        status: toAgentRunStatus(input.status),
        durationMs: input.durationMs,
        // CI ingest never sees token counts (agent-runner doesn't report
        // them in `devdigest-result.json`) — always null, not a guess.
        tokensIn: null,
        tokensOut: null,
        costUsd: input.costUsd,
        findingsCount: input.findingsCount,
        source: 'ci' as const,
        ...(input.ranAt ? { ranAt: input.ranAt } : {}),
      };

      let agentRunId: string;
      if (existingRun?.agentRunId) {
        await tx
          .update(t.agentRuns)
          .set(agentRunValues)
          .where(eq(t.agentRuns.id, existingRun.agentRunId));
        agentRunId = existingRun.agentRunId;
      } else {
        const [inserted] = await tx
          .insert(t.agentRuns)
          .values(agentRunValues)
          .returning({ id: t.agentRuns.id });
        agentRunId = inserted!.id;
      }

      const ciRunValues = {
        ciInstallationId: input.ciInstallationId,
        workflowRunId: input.workflowRunId,
        prNumber: input.prNumber,
        ranAt: input.ranAt,
        status: input.status,
        findingsCount: input.findingsCount,
        costUsd: input.costUsd,
        githubUrl: input.githubUrl,
        source: 'ci',
        agentRunId,
      };

      await tx
        .insert(t.ciRuns)
        .values(ciRunValues)
        .onConflictDoUpdate({
          target: [t.ciRuns.ciInstallationId, t.ciRuns.workflowRunId],
          set: ciRunValues,
        });
    });
  }

  // ---- memory (D10) -------------------------------------------------------

  /** Content-only projection for `.devdigest/memory.jsonl` — never selects
   *  `embedding` (D10). Newest first, capped by the caller-supplied limit. */
  async listMemory(workspaceId: string, limit: number): Promise<MemoryEntry[]> {
    const rows = await this.db
      .select({
        scope: t.memory.scope,
        kind: t.memory.kind,
        content: t.memory.content,
        confidence: t.memory.confidence,
        createdAt: t.memory.createdAt,
      })
      .from(t.memory)
      .where(eq(t.memory.workspaceId, workspaceId))
      .orderBy(desc(t.memory.createdAt))
      .limit(limit);

    return rows.map((row) => ({
      scope: row.scope,
      kind: row.kind,
      content: row.content,
      confidence: row.confidence,
      created_at: row.createdAt.toISOString(),
    }));
  }

  // ---- internal ---------------------------------------------------------

  /** Most recent `ci_runs` row per installation id, for `listInstallations`. */
  private async latestRunsByInstallation(
    installationIds: string[],
  ): Promise<Map<string, CiRunRow>> {
    if (installationIds.length === 0) return new Map();

    const rows = await this.db
      .select({
        run: t.ciRuns,
        agentName: t.agents.name,
        repo: t.ciInstallations.repo,
        durationMs: t.agentRuns.durationMs,
      })
      .from(t.ciRuns)
      .innerJoin(t.ciInstallations, eq(t.ciInstallations.id, t.ciRuns.ciInstallationId))
      .innerJoin(t.agents, eq(t.agents.id, t.ciInstallations.agentId))
      .leftJoin(t.agentRuns, eq(t.agentRuns.id, t.ciRuns.agentRunId))
      .where(inArray(t.ciRuns.ciInstallationId, installationIds))
      .orderBy(desc(t.ciRuns.ranAt));

    const map = new Map<string, CiRunRow>();
    for (const { run, agentName, repo, durationMs } of rows) {
      if (!run.ciInstallationId || map.has(run.ciInstallationId)) continue;
      map.set(run.ciInstallationId, toCiRunRow(run, { agentName, repo, durationMs }));
    }
    return map;
  }
}
