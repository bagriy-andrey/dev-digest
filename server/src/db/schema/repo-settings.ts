import { pgTable, uuid, text, primaryKey } from 'drizzle-orm/pg-core';
import { repos } from './repos';

/**
 * Per-repository overrides for a system LLM feature's model. Resolution order is
 * repo override → workspace Settings override → FEATURE_MODELS registry default.
 * Generic over feature_id (TEXT = FeatureModelId) so future features reuse it; the
 * Intent Layer is the first consumer (feature_id = 'review_intent').
 */
export const repoFeatureModels = pgTable(
  'repo_feature_models',
  {
    repoId: uuid('repo_id')
      .notNull()
      .references(() => repos.id, { onDelete: 'cascade' }),
    featureId: text('feature_id').notNull(),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.repoId, t.featureId] }) }),
);
