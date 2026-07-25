import { asc, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { ContextAttachment } from '@devdigest/shared';

/**
 * Project Context module (SPEC-01) — data access for the two path-only
 * attachment link tables (`agent_context_docs` / `skill_context_docs`,
 * mirroring `agent_skills`'s `(fk, order)` shape — see
 * `AgentsRepository.setSkills`) and the deterministic per-repo scan-state
 * table (`repo_context_index`).
 */

export interface ScanState {
  files: number;
  chunks: number;
  scannedAt: Date;
}

export class ContextRepository {
  constructor(private db: Db) {}

  // ---- agent_context_docs --------------------------------------------

  /** An agent's directly-attached docs, in persisted drag order. */
  async getAgentDocs(agentId: string): Promise<ContextAttachment[]> {
    return this.db
      .select({ path: t.agentContextDocs.path, order: t.agentContextDocs.order })
      .from(t.agentContextDocs)
      .where(eq(t.agentContextDocs.agentId, agentId))
      .orderBy(asc(t.agentContextDocs.order));
  }

  /**
   * Replace the full set of directly-attached docs for an agent, assigning
   * `order = index` (mirrors `AgentsRepository.setSkills`'s delete-all +
   * insert-with-order pattern).
   */
  async setAgentDocs(agentId: string, paths: string[]): Promise<void> {
    await this.db.delete(t.agentContextDocs).where(eq(t.agentContextDocs.agentId, agentId));
    if (paths.length === 0) return;
    await this.db
      .insert(t.agentContextDocs)
      .values(paths.map((path, i) => ({ agentId, path, order: i })));
  }

  // ---- skill_context_docs ---------------------------------------------

  /** A skill's attached docs, in persisted order. */
  async getSkillDocs(skillId: string): Promise<ContextAttachment[]> {
    return this.db
      .select({ path: t.skillContextDocs.path, order: t.skillContextDocs.order })
      .from(t.skillContextDocs)
      .where(eq(t.skillContextDocs.skillId, skillId))
      .orderBy(asc(t.skillContextDocs.order));
  }

  /** Replace the full set of attached docs for a skill (same shape as `setAgentDocs`). */
  async setSkillDocs(skillId: string, paths: string[]): Promise<void> {
    await this.db.delete(t.skillContextDocs).where(eq(t.skillContextDocs.skillId, skillId));
    if (paths.length === 0) return;
    await this.db
      .insert(t.skillContextDocs)
      .values(paths.map((path, i) => ({ skillId, path, order: i })));
  }

  // ---- workspace-wide maps (for the "Used by N agents" / COVERAGE metrics) --

  /** Every agent's directly-attached doc paths in this workspace, keyed by agent id. */
  async allAgentDocs(workspaceId: string): Promise<Map<string, string[]>> {
    const rows = await this.db
      .select({ agentId: t.agentContextDocs.agentId, path: t.agentContextDocs.path })
      .from(t.agentContextDocs)
      .innerJoin(t.agents, eq(t.agentContextDocs.agentId, t.agents.id))
      .where(eq(t.agents.workspaceId, workspaceId))
      .orderBy(asc(t.agentContextDocs.order));

    const map = new Map<string, string[]>();
    for (const row of rows) {
      const list = map.get(row.agentId);
      if (list) list.push(row.path);
      else map.set(row.agentId, [row.path]);
    }
    return map;
  }

  /** Every skill's attached doc paths in this workspace, keyed by skill id. */
  async allSkillDocs(workspaceId: string): Promise<Map<string, string[]>> {
    const rows = await this.db
      .select({ skillId: t.skillContextDocs.skillId, path: t.skillContextDocs.path })
      .from(t.skillContextDocs)
      .innerJoin(t.skills, eq(t.skillContextDocs.skillId, t.skills.id))
      .where(eq(t.skills.workspaceId, workspaceId))
      .orderBy(asc(t.skillContextDocs.order));

    const map = new Map<string, string[]>();
    for (const row of rows) {
      const list = map.get(row.skillId);
      if (list) list.push(row.path);
      else map.set(row.skillId, [row.path]);
    }
    return map;
  }

  // ---- repo_context_index (footer scan state) --------------------------

  async getScanState(repoId: string): Promise<ScanState | undefined> {
    const [row] = await this.db
      .select()
      .from(t.repoContextIndex)
      .where(eq(t.repoContextIndex.repoId, repoId));
    return row ? { files: row.files, chunks: row.chunks, scannedAt: row.scannedAt } : undefined;
  }

  async upsertScanState(repoId: string, state: ScanState): Promise<void> {
    await this.db
      .insert(t.repoContextIndex)
      .values({ repoId, files: state.files, chunks: state.chunks, scannedAt: state.scannedAt })
      .onConflictDoUpdate({
        target: t.repoContextIndex.repoId,
        set: { files: state.files, chunks: state.chunks, scannedAt: state.scannedAt },
      });
  }
}
