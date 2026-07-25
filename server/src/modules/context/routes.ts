import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { ContextDoc, ContextIndexStatus, ContextAttachment, ContextFileContent } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { ContextService } from './service.js';

/**
 * Project Context module (SPEC-01).
 *   GET  /repos/:id/context               → ContextDoc[]           (discovered docs + metrics)
 *   GET  /repos/:id/context/file?path=     → ContextFileContent     (view-only Preview; path-guarded sink)
 *   POST /repos/:id/context/reindex        → ContextIndexStatus     (AC-4 manual refresh)
 *   GET  /agents/:id/context               → ContextAttachment[]
 *   PUT  /agents/:id/context               → ContextAttachment[]
 *   GET  /skills/:id/context               → ContextAttachment[]
 *   PUT  /skills/:id/context               → ContextAttachment[]
 *
 * All routes are workspace-scoped via `getContext` (same pattern as `skills`
 * routes). The service is NOT in the DI container (matches `SkillsService`'s
 * precedent) — instantiated directly per request.
 */

const FileQuery = z.object({ path: z.string().min(1) });
const SetDocsBody = z.object({ paths: z.array(z.string()) });

export default async function contextRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();

  const getService = () => new ContextService(app.container);

  // ---- repo-scoped: discovery, preview, reindex ------------------------

  app.get(
    '/repos/:id/context',
    { schema: { params: IdParams, response: { 200: z.array(ContextDoc) } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return getService().listForRepo(workspaceId, req.params.id);
    },
  );

  app.get(
    '/repos/:id/context/file',
    { schema: { params: IdParams, querystring: FileQuery, response: { 200: ContextFileContent } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return getService().getFileContent(workspaceId, req.params.id, req.query.path);
    },
  );

  app.post(
    '/repos/:id/context/reindex',
    { schema: { params: IdParams, response: { 200: ContextIndexStatus } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return getService().reindex(workspaceId, req.params.id);
    },
  );

  // ---- agent Context tab (Screen 2) -------------------------------------

  app.get(
    '/agents/:id/context',
    { schema: { params: IdParams, response: { 200: z.array(ContextAttachment) } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return getService().getAgentDocs(workspaceId, req.params.id);
    },
  );

  app.put(
    '/agents/:id/context',
    { schema: { params: IdParams, body: SetDocsBody, response: { 200: z.array(ContextAttachment) } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return getService().setAgentDocs(workspaceId, req.params.id, req.body.paths);
    },
  );

  // ---- skill Context tab (Screen 3) -------------------------------------

  app.get(
    '/skills/:id/context',
    { schema: { params: IdParams, response: { 200: z.array(ContextAttachment) } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return getService().getSkillDocs(workspaceId, req.params.id);
    },
  );

  app.put(
    '/skills/:id/context',
    { schema: { params: IdParams, body: SetDocsBody, response: { 200: z.array(ContextAttachment) } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return getService().setSkillDocs(workspaceId, req.params.id, req.body.paths);
    },
  );
}
