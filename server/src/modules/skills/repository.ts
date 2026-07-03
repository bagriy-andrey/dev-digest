import { and, count, countDistinct, eq, gte, isNotNull, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { Skill, SkillSource, SkillType } from '@devdigest/shared';

export type SkillRow = typeof t.skills.$inferSelect;

export interface InsertSkill {
  workspaceId: string;
  name: string;
  description?: string;
  type: SkillType;
  source: SkillSource;
  body: string;
  enabled?: boolean;
}

export interface UpdateSkill {
  name?: string;
  description?: string;
  type?: SkillType;
  body?: string;
  enabled?: boolean;
}

export interface SkillStats {
  agentsCount: number;
  pullFrequencyPct: number;
  acceptRatePct: number;
  findings30d: number;
  agentsUsing: { id: string; name: string }[];
  findingsByCategory: { category: string; count: number }[];
}

export function toSkillDto(row: SkillRow): Skill {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    type: row.type as SkillType,
    source: row.source as SkillSource,
    body: row.body,
    enabled: row.enabled,
    version: row.version,
    evidence_files: (row.evidenceFiles as string[] | null) ?? null,
  };
}

export class SkillsRepository {
  constructor(private db: Db) {}

  async list(workspaceId: string): Promise<SkillRow[]> {
    return this.db
      .select()
      .from(t.skills)
      .where(eq(t.skills.workspaceId, workspaceId));
  }

  async getById(workspaceId: string, id: string): Promise<SkillRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id)));
    return row;
  }

  async insert(values: InsertSkill): Promise<SkillRow> {
    const [row] = await this.db
      .insert(t.skills)
      .values({
        workspaceId: values.workspaceId,
        name: values.name,
        description: values.description ?? '',
        type: values.type,
        source: values.source,
        body: values.body,
        enabled: values.enabled ?? true,
        version: 1,
      })
      .returning();
    return row!;
  }

  async update(workspaceId: string, id: string, patch: UpdateSkill): Promise<SkillRow | undefined> {
    const existing = await this.getById(workspaceId, id);
    if (!existing) return undefined;

    const bodyChanged = patch.body !== undefined && patch.body !== existing.body;
    const nextVersion = bodyChanged ? existing.version + 1 : existing.version;

    if (bodyChanged) {
      await this.db.insert(t.skillVersions).values({
        skillId: id,
        version: existing.version,
        body: existing.body,
      }).onConflictDoNothing();
    }

    const [row] = await this.db
      .update(t.skills)
      .set({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.description !== undefined ? { description: patch.description } : {}),
        ...(patch.type !== undefined ? { type: patch.type } : {}),
        ...(patch.body !== undefined ? { body: patch.body } : {}),
        ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
        ...(bodyChanged ? { version: nextVersion } : {}),
      })
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id)))
      .returning();
    return row;
  }

  async deleteById(workspaceId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id)))
      .returning({ id: t.skills.id });
    return rows.length > 0;
  }

  async listVersions(skillId: string): Promise<typeof t.skillVersions.$inferSelect[]> {
    return this.db
      .select()
      .from(t.skillVersions)
      .where(eq(t.skillVersions.skillId, skillId))
      .orderBy(sql`${t.skillVersions.version} DESC`);
  }

  async getStats(workspaceId: string, skillId: string): Promise<SkillStats> {
    const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    // Agents that have this skill linked
    const agentLinks = await this.db
      .select({ id: t.agents.id, name: t.agents.name })
      .from(t.agentSkills)
      .innerJoin(t.agents, eq(t.agentSkills.agentId, t.agents.id))
      .where(
        and(
          eq(t.agentSkills.skillId, skillId),
          eq(t.agents.workspaceId, workspaceId),
        ),
      );

    const agentIds = agentLinks.map((a) => a.id);

    if (agentIds.length === 0) {
      return {
        agentsCount: 0,
        pullFrequencyPct: 0,
        acceptRatePct: 0,
        findings30d: 0,
        agentsUsing: [],
        findingsByCategory: [],
      };
    }

    // Total runs and runs by these agents in last 30d
    const [totalRunsRow] = await this.db
      .select({ n: count() })
      .from(t.agentRuns)
      .where(
        and(
          eq(t.agentRuns.workspaceId, workspaceId),
          eq(t.agentRuns.status, 'done'),
          gte(t.agentRuns.ranAt, since30d),
        ),
      );

    const [skillRunsRow] = await this.db
      .select({ n: count() })
      .from(t.agentRuns)
      .where(
        and(
          eq(t.agentRuns.workspaceId, workspaceId),
          eq(t.agentRuns.status, 'done'),
          gte(t.agentRuns.ranAt, since30d),
          sql`${t.agentRuns.agentId} = ANY(ARRAY[${sql.join(agentIds.map((id) => sql`${id}::uuid`), sql`, `)}])`,
        ),
      );

    const totalRuns = (totalRunsRow?.n as number) ?? 0;
    const skillRuns = (skillRunsRow?.n as number) ?? 0;
    const pullFrequencyPct = totalRuns > 0 ? Math.round((skillRuns / totalRuns) * 100) : 0;

    // Findings in last 30d from agents using this skill
    const findingRows = await this.db
      .select({
        id: t.findings.id,
        category: t.findings.category,
        acceptedAt: t.findings.acceptedAt,
        dismissedAt: t.findings.dismissedAt,
      })
      .from(t.findings)
      .innerJoin(t.reviews, eq(t.findings.reviewId, t.reviews.id))
      .innerJoin(t.agentRuns, eq(t.reviews.runId, t.agentRuns.id))
      .where(
        and(
          eq(t.reviews.workspaceId, workspaceId),
          gte(t.agentRuns.ranAt, since30d),
          sql`${t.agentRuns.agentId} = ANY(ARRAY[${sql.join(agentIds.map((id) => sql`${id}::uuid`), sql`, `)}])`,
        ),
      );

    const findings30d = findingRows.length;

    const reviewed = findingRows.filter((f) => f.acceptedAt !== null || f.dismissedAt !== null);
    const accepted = findingRows.filter((f) => f.acceptedAt !== null);
    const acceptRatePct = reviewed.length > 0 ? Math.round((accepted.length / reviewed.length) * 100) : 0;

    const catMap = new Map<string, number>();
    for (const f of findingRows) {
      catMap.set(f.category, (catMap.get(f.category) ?? 0) + 1);
    }
    const findingsByCategory = [...catMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([category, count]) => ({ category, count }));

    return {
      agentsCount: agentLinks.length,
      pullFrequencyPct,
      acceptRatePct,
      findings30d,
      agentsUsing: agentLinks,
      findingsByCategory,
    };
  }
}
