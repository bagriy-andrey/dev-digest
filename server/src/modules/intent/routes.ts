import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { Intent, RepoFeatureModel, FeatureModelChoice } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { IntentService } from './service.js';

/**
 * Intent classifier module.
 *   GET  /pulls/:id/intent               → stored Intent | null (never computes)
 *   POST /pulls/:id/intent/recalculate   → classify + upsert Intent (rate-limited: fans out to a paid LLM)
 *   GET  /repos/:id/intent-model         → repo-level classifier model override | null
 *   PUT  /repos/:id/intent-model         → set the repo-level classifier model override
 *
 * The `/repos/:id/intent-model` endpoints hardcode the feature id to
 * `'review_intent'` server-side (never accepted from the client body) and
 * verify the repo belongs to the caller's workspace before read/write.
 */
export default async function intentRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();

  const getService = () => new IntentService(app.container);

  app.get(
    '/pulls/:id/intent',
    { schema: { params: IdParams, response: { 200: Intent.nullable() } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return getService().get(workspaceId, req.params.id);
    },
  );

  app.post(
    '/pulls/:id/intent/recalculate',
    {
      schema: { params: IdParams, response: { 200: Intent } },
      // Tight per-route limit: each call fans out to a paid LLM (mirrors /pulls/:id/review).
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const { intent } = await getService().recalculate(workspaceId, req.params.id, req.log);
      return intent;
    },
  );

  app.get(
    '/repos/:id/intent-model',
    { schema: { params: IdParams, response: { 200: RepoFeatureModel.nullable() } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return getService().getRepoModel(workspaceId, req.params.id);
    },
  );

  app.put(
    '/repos/:id/intent-model',
    {
      schema: {
        params: IdParams,
        body: FeatureModelChoice,
        response: { 200: RepoFeatureModel },
      },
    },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return getService().setRepoModel(workspaceId, req.params.id, req.body);
    },
  );
}
