import { and, eq } from 'drizzle-orm';
import {
  FEATURE_MODELS,
  FeatureModelChoice,
  type FeatureModelId,
} from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import * as t from '../../db/schema.js';
import { rowsToSettings } from './helpers.js';

/**
 * Per-feature model configuration.
 *
 * System LLM features (onboarding, intent, risk brief, conformance, conventions)
 * read their provider/model from the workspace's Settings instead of a hardcoded
 * module constant. When the workspace hasn't chosen one, we fall back to the
 * registry default in `FEATURE_MODELS` — which mirrors each module's old
 * constant, so behaviour is unchanged until a model is explicitly picked.
 */

const DEFAULTS = Object.fromEntries(
  FEATURE_MODELS.map((f) => [f.id, { provider: f.defaultProvider, model: f.defaultModel }]),
) as Record<FeatureModelId, FeatureModelChoice>;

/** The registry default (provider+model) for a feature — no DB read. */
export function defaultFeatureModel(id: FeatureModelId): FeatureModelChoice {
  return DEFAULTS[id];
}

/**
 * The workspace's override for `id`, or `undefined` when unset/invalid. Callers
 * that keep their own dynamic default (e.g. conventions) use this directly so
 * that default is preserved; callers with a static default use
 * `resolveFeatureModel` instead.
 */
export async function getFeatureModelOverride(
  container: Container,
  workspaceId: string,
  id: FeatureModelId,
): Promise<FeatureModelChoice | undefined> {
  const rows = await container.db
    .select({ key: t.settings.key, value: t.settings.value })
    .from(t.settings)
    .where(eq(t.settings.workspaceId, workspaceId));
  const fm = (rowsToSettings(rows) as { feature_models?: Record<string, unknown> }).feature_models;
  const parsed = FeatureModelChoice.safeParse(fm?.[id]);
  return parsed.success ? parsed.data : undefined;
}

/** Resolve `id` to a concrete provider+model: workspace override, else registry default. */
export async function resolveFeatureModel(
  container: Container,
  workspaceId: string,
  id: FeatureModelId,
): Promise<FeatureModelChoice> {
  return (await getFeatureModelOverride(container, workspaceId, id)) ?? DEFAULTS[id];
}

/**
 * The repo's override for `id`, or `undefined` when unset/invalid. Reused by
 * `resolveFeatureModelForRepo` and by the settings routes to check whether a
 * repo-level override currently exists (without falling back to workspace/default).
 */
export async function getRepoFeatureModel(
  container: Container,
  repoId: string,
  id: FeatureModelId,
): Promise<FeatureModelChoice | undefined> {
  const [row] = await container.db
    .select({ provider: t.repoFeatureModels.provider, model: t.repoFeatureModels.model })
    .from(t.repoFeatureModels)
    .where(and(eq(t.repoFeatureModels.repoId, repoId), eq(t.repoFeatureModels.featureId, id)));
  const parsed = FeatureModelChoice.safeParse(row);
  return parsed.success ? parsed.data : undefined;
}

/** Upsert the repo's override for `id` to `choice`. */
export async function setRepoFeatureModel(
  container: Container,
  repoId: string,
  id: FeatureModelId,
  choice: FeatureModelChoice,
): Promise<void> {
  await container.db
    .insert(t.repoFeatureModels)
    .values({ repoId, featureId: id, provider: choice.provider, model: choice.model })
    .onConflictDoUpdate({
      target: [t.repoFeatureModels.repoId, t.repoFeatureModels.featureId],
      set: { provider: choice.provider, model: choice.model },
    });
}

/**
 * Resolve `id` to a concrete provider+model for a specific repo: repo override,
 * else workspace override, else registry default. Workspace ownership of `repoId`
 * is enforced by the caller (route/service), not here.
 */
export async function resolveFeatureModelForRepo(
  container: Container,
  workspaceId: string,
  repoId: string,
  id: FeatureModelId,
): Promise<FeatureModelChoice> {
  const repoChoice = await getRepoFeatureModel(container, repoId, id);
  if (repoChoice) return repoChoice;
  return resolveFeatureModel(container, workspaceId, id);
}
