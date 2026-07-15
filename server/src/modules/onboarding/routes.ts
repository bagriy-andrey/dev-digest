import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { OnboardingDoc } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { OnboardingService } from './service.js';

/**
 * Onboarding generator module (SPEC-01 onboarding-generator).
 *   GET  /repos/:id/onboarding           → the current document (possibly null — AC-17)
 *   POST /repos/:id/onboarding/generate  → run Generate/Regenerate (same endpoint, AC-20)
 */
export default async function onboardingRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();

  const getService = () => new OnboardingService(app.container);

  app.get(
    '/repos/:id/onboarding',
    { schema: { params: IdParams, response: { 200: OnboardingDoc } } },
    async (req) => {
      const service = getService();
      return service.get(req.params.id);
    },
  );

  app.post(
    '/repos/:id/onboarding/generate',
    { schema: { params: IdParams, response: { 200: OnboardingDoc } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const service = getService();
      return service.generate(workspaceId, req.params.id, req.log);
    },
  );
}
