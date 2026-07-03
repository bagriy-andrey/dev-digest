import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { ConventionCandidate } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { ConventionsService } from './service.js';

/**
 * Conventions extraction module.
 *   POST /repos/:id/conventions/extract   → run extraction pipeline
 *   GET  /repos/:id/conventions           → list candidates
 *   POST /repos/:id/conventions/to-skill  → create skill from selected candidates
 */

const ToSkillBody = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).default(''),
  candidateIds: z.array(z.string().uuid()).min(1),
});

export default async function conventionsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();

  const getService = () => new ConventionsService(app.container);

  app.post(
    '/repos/:id/conventions/extract',
    { schema: { params: IdParams, response: { 200: z.array(ConventionCandidate) } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const service = getService();
      return service.extract(workspaceId, req.params.id);
    },
  );

  app.get(
    '/repos/:id/conventions',
    { schema: { params: IdParams, response: { 200: z.array(ConventionCandidate) } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const service = getService();
      return service.list(workspaceId, req.params.id);
    },
  );

  app.post(
    '/repos/:id/conventions/to-skill',
    {
      schema: {
        params: IdParams,
        body: ToSkillBody,
        response: { 200: z.object({ skillId: z.string().uuid() }) },
      },
    },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const service = getService();
      return service.createSkill(
        workspaceId,
        req.body.candidateIds,
        req.body.name,
        req.body.description,
      );
    },
  );
}
