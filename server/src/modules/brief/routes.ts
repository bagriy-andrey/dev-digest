import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { Brief } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { BriefService } from './service.js';

/**
 * PR Why + Risk Brief module.
 *   GET  /pulls/:id/brief   → stored Brief | null (never generates — AC-13)
 *   POST /pulls/:id/brief   → generate (or regenerate) + upsert the Brief (rate-limited: fans out to a paid LLM)
 *
 * Both routes are workspace-scoped via `getContext`, mirroring `intent/routes.ts`.
 */
export default async function briefRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();

  const getService = () => new BriefService(app.container);

  app.get(
    '/pulls/:id/brief',
    { schema: { params: IdParams, response: { 200: Brief.nullable() } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return getService().get(workspaceId, req.params.id);
    },
  );

  app.post(
    '/pulls/:id/brief',
    {
      schema: { params: IdParams, response: { 200: Brief } },
      // Tight per-route limit: each call fans out to a paid LLM (mirrors /pulls/:id/intent/recalculate).
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const { brief } = await getService().generate(workspaceId, req.params.id, req.log);
      return brief;
    },
  );
}
