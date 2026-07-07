import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { SmartDiff } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { SmartDiffService } from './service.js';

/**
 * Smart Diff — deterministic risk-based file grouping for a PR's diff.
 *   GET /pulls/:id/smart-diff → SmartDiff
 *
 * Read-only composition of two already-persisted things (prFiles + the most
 * recent completed review's findings) — no LLM call, so no rate limit
 * (unlike `/pulls/:id/review` and `/pulls/:id/intent/recalculate`).
 */
export default async function smartDiffRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();

  app.get(
    '/pulls/:id/smart-diff',
    { schema: { params: IdParams, response: { 200: SmartDiff } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return new SmartDiffService(app.container).get(workspaceId, req.params.id);
    },
  );
}
