import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { BlastRadius } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { BlastService } from './service.js';

/**
 * Blast Radius module.
 *   GET  /pulls/:id/blast            → BlastRadiusResponse (always: zero LLM calls)
 *   POST /pulls/:id/blast/summarize  → BlastRadiusResponse (OPTIONAL — one LLM call;
 *                                       rate-limited like /intent/recalculate; never
 *                                       triggered automatically by the GET route)
 *
 * Read-only — composes the already-computed `repoIntel.getBlastRadius()`
 * result into the `BlastRadius` contract. No mutation, ZERO LLM calls on the
 * GET path, no rate-limit config needed there (unlike `/review` or
 * `/intent/recalculate`).
 *
 * `BlastRadiusResponse` extends the vendored `BlastRadius` contract locally
 * (not a vendored-file edit) with transport-only `degraded`/`degraded_reason`
 * fields — `BlastRadius` itself is the LLM/`PrBrief`-composable domain shape
 * and stays clean of observability fields.
 */
const BlastRadiusResponse = BlastRadius.extend({
  degraded: z.boolean().optional(),
  degraded_reason: z.string().nullish(),
});

export default async function blastRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();

  const getService = () => new BlastService(app.container);

  app.get(
    '/pulls/:id/blast',
    { schema: { params: IdParams, response: { 200: BlastRadiusResponse } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return getService().get(workspaceId, req.params.id);
    },
  );

  app.post(
    '/pulls/:id/blast/summarize',
    {
      schema: { params: IdParams, response: { 200: BlastRadiusResponse } },
      // Tight per-route limit: each call fans out to a paid LLM (mirrors /intent/recalculate).
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return getService().summarize(workspaceId, req.params.id, req.log);
    },
  );
}
