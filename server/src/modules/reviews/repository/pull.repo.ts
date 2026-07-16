import { and, desc, eq, inArray, ne } from 'drizzle-orm';
import type { Db } from '../../../db/client.js';
import * as t from '../../../db/schema.js';
import { Brief, type Intent } from '@devdigest/shared';
import type { PullRow } from '../../../db/rows.js';

// ---- PR lookup (workspace-scoped) -----------------------------------------

export async function getPull(
  db: Db,
  workspaceId: string,
  prId: string,
): Promise<PullRow | undefined> {
  const [row] = await db
    .select()
    .from(t.pullRequests)
    .where(and(eq(t.pullRequests.workspaceId, workspaceId), eq(t.pullRequests.id, prId)));
  return row;
}

export async function getRepo(
  db: Db,
  repoId: string,
): Promise<typeof t.repos.$inferSelect | undefined> {
  const [row] = await db.select().from(t.repos).where(eq(t.repos.id, repoId));
  return row;
}

export async function getPrFiles(
  db: Db,
  prId: string,
): Promise<(typeof t.prFiles.$inferSelect)[]> {
  return db.select().from(t.prFiles).where(eq(t.prFiles.prId, prId));
}

/**
 * Other PRs in the same repo whose changed files overlap `paths`, excluding
 * `excludePrId` (the current PR), newest-first. Exact-path overlap only (no
 * rename-awareness — see `server/specs/blast-radius-gaps.md` §5).
 */
export async function getPrsTouchingFiles(
  db: Db,
  repoId: string,
  excludePrId: string,
  paths: string[],
): Promise<{ id: string; number: number; title: string }[]> {
  if (paths.length === 0) return [];
  return db
    .selectDistinct({
      id: t.pullRequests.id,
      number: t.pullRequests.number,
      title: t.pullRequests.title,
    })
    .from(t.pullRequests)
    .innerJoin(t.prFiles, eq(t.prFiles.prId, t.pullRequests.id))
    .where(
      and(
        eq(t.pullRequests.repoId, repoId),
        ne(t.pullRequests.id, excludePrId),
        inArray(t.prFiles.path, paths),
      ),
    )
    .orderBy(desc(t.pullRequests.number));
}

/**
 * Record the commit a review just ran against, so the PR list can derive
 * `reviewed` vs `needs_review` (head moved since the last review) vs `stale`.
 */
export async function markReviewed(db: Db, prId: string, sha: string): Promise<void> {
  await db
    .update(t.pullRequests)
    .set({ lastReviewedSha: sha })
    .where(eq(t.pullRequests.id, prId));
}

// ---- intent ---------------------------------------------------------------

export async function upsertIntent(db: Db, prId: string, intent: Intent): Promise<void> {
  await db
    .insert(t.prIntent)
    .values({
      prId,
      intent: intent.intent,
      inScope: intent.in_scope,
      outOfScope: intent.out_of_scope,
    })
    .onConflictDoUpdate({
      target: t.prIntent.prId,
      set: { intent: intent.intent, inScope: intent.in_scope, outOfScope: intent.out_of_scope },
    });
}

export async function getIntent(db: Db, prId: string): Promise<Intent | undefined> {
  const [row] = await db.select().from(t.prIntent).where(eq(t.prIntent.prId, prId));
  if (!row) return undefined;
  return { intent: row.intent, in_scope: row.inScope, out_of_scope: row.outOfScope };
}

// ---- PR Why + Risk Brief ---------------------------------------------------

export async function upsertBrief(db: Db, prId: string, brief: Brief): Promise<void> {
  await db
    .insert(t.prBrief)
    .values({ prId, json: brief })
    .onConflictDoUpdate({
      target: t.prBrief.prId,
      set: { json: brief },
    });
}

/**
 * Reads the cached `Brief` for a PR. Parses defensively — the `json` column
 * is untyped jsonb, so a missing/legacy/garbage row degrades to `undefined`
 * ("not generated yet") instead of throwing.
 */
export async function getBrief(db: Db, prId: string): Promise<Brief | undefined> {
  try {
    const [row] = await db.select().from(t.prBrief).where(eq(t.prBrief.prId, prId));
    if (!row) return undefined;
    return Brief.parse(row.json);
  } catch {
    return undefined;
  }
}
