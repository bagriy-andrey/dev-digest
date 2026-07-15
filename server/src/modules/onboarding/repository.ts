import { eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { Onboarding, OnboardingDoc } from '@devdigest/shared';

/** Thin Drizzle wrapper over the `onboarding` table — no business logic. */
export interface OnboardingRow {
  json: Onboarding;
  sourceSha: string | null;
  generatedAt: Date;
}

export interface UpsertOnboardingInput {
  json: Onboarding;
  sourceSha: string | null;
  costCents: number | null;
}

export class OnboardingRepository {
  constructor(private db: Db) {}

  async get(repoId: string): Promise<OnboardingRow | null> {
    const [row] = await this.db
      .select({
        json: t.onboarding.json,
        sourceSha: t.onboarding.sourceSha,
        generatedAt: t.onboarding.generatedAt,
      })
      .from(t.onboarding)
      .where(eq(t.onboarding.repoId, repoId));

    if (!row) return null;
    return {
      json: row.json as Onboarding,
      sourceSha: row.sourceSha,
      generatedAt: row.generatedAt,
    };
  }

  /** `onConflictDoUpdate` on `repoId` — exactly one row per repo (AC-12, last-write-wins). */
  async upsert(repoId: string, input: UpsertOnboardingInput): Promise<void> {
    const generatedAt = new Date();
    await this.db
      .insert(t.onboarding)
      .values({
        repoId,
        json: input.json,
        sourceSha: input.sourceSha,
        costCents: input.costCents,
        generatedAt,
      })
      .onConflictDoUpdate({
        target: t.onboarding.repoId,
        set: {
          json: input.json,
          sourceSha: input.sourceSha,
          costCents: input.costCents,
          generatedAt,
        },
      });
  }

  /** Row → response doc; `null` row → the "never generated" doc (AC-17 — never a 404 shape). */
  toDoc(row: OnboardingRow | null): OnboardingDoc {
    if (!row) return { onboarding: null, source_sha: null, generated_at: null };
    return {
      onboarding: row.json,
      source_sha: row.sourceSha,
      generated_at: row.generatedAt.toISOString(),
    };
  }
}
