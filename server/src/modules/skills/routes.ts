import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { SkillType, SkillSource } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError } from '../../platform/errors.js';
import { SkillsService } from './service.js';

/**
 * A1 — skills module.
 *   GET    /skills                  → list (workspace-scoped)
 *   GET    /skills/:id              → one skill
 *   POST   /skills                  → create
 *   PUT    /skills/:id              → update
 *   DELETE /skills/:id              → delete
 *   GET    /skills/:id/stats        → usage stats
 *   GET    /skills/:id/versions     → body history
 *   POST   /skills/import/file      → parse markdown/zip → preview (no persist)
 *   POST   /skills/import/url       → fetch + parse → preview (no persist)
 *   GET    /skills/community        → stub community list
 */

const CreateSkillBody = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).default(''),
  type: SkillType,
  body: z.string().min(1),
  source: SkillSource.default('manual'),
  enabled: z.boolean().default(true),
});

const UpdateSkillBody = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(500).optional(),
  type: SkillType.optional(),
  body: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
});

const ImportUrlBody = z.object({
  url: z.string().url(),
});

export default async function skillsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();

  // Service is not in the DI container (A1 lesson scope) — instantiate directly.
  const getService = () => new SkillsService(app.container.db);

  // ---- import endpoints (no :id, must come before /:id routes) ----

  app.post('/skills/import/file', async (req, reply) => {
    const data = await req.file();
    if (!data) {
      reply.status(400);
      return { error: 'No file uploaded' };
    }
    const service = getService();
    const buf = await data.toBuffer();
    const filename = data.filename ?? 'skill.md';

    if (filename.toLowerCase().endsWith('.zip')) {
      return service.parseZipFile(buf);
    }
    const text = buf.toString('utf8');
    return service.parseMarkdownFile(filename, text);
  });

  app.post(
    '/skills/import/url',
    { schema: { body: ImportUrlBody } },
    async (req) => {
      const { url } = req.body;
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
      const text = await res.text();
      const service = getService();
      const filename = url.split('/').pop() ?? 'skill.md';
      return { ...service.parseMarkdownFile(filename, text), source: 'imported_url' as const };
    },
  );

  app.get('/skills/community', async () => {
    return [
      { name: 'no-then-chains',       description: 'Enforce async/await over promise chains.',       type: 'convention', stars: 142 },
      { name: 'secret-leakage-gate',  description: 'Flag hardcoded secrets and tokens.',             type: 'security',   stars: 318 },
      { name: 'lethal-trifecta',      description: 'Detect private data + untrusted input + exfil.', type: 'security',   stars: 275 },
      { name: 'pr-quality-rubric',    description: 'Multi-dimension PR quality checklist.',           type: 'rubric',     stars: 201 },
      { name: 'phantom-api-gate',     description: 'Detect imports of removed/renamed modules.',     type: 'security',   stars: 89  },
    ];
  });

  // ---- CRUD ----

  app.get('/skills', async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return getService().list(workspaceId);
  });

  app.get('/skills/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const skill = await getService().get(workspaceId, req.params.id);
    if (!skill) throw new NotFoundError('Skill not found');
    return skill;
  });

  app.post('/skills', { schema: { body: CreateSkillBody } }, async (req, reply) => {
    const { workspaceId } = await getContext(app.container, req);
    const skill = await getService().create(workspaceId, req.body);
    reply.status(201);
    return skill;
  });

  app.put('/skills/:id', { schema: { params: IdParams, body: UpdateSkillBody } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const skill = await getService().update(workspaceId, req.params.id, req.body);
    if (!skill) throw new NotFoundError('Skill not found');
    return skill;
  });

  app.delete('/skills/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const ok = await getService().delete(workspaceId, req.params.id);
    if (!ok) throw new NotFoundError('Skill not found');
    return { ok: true };
  });

  app.get('/skills/:id/stats', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const stats = await getService().getStats(workspaceId, req.params.id);
    if (!stats) throw new NotFoundError('Skill not found');
    return stats;
  });

  app.get('/skills/:id/versions', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const versions = await getService().listVersions(workspaceId, req.params.id);
    if (!versions) throw new NotFoundError('Skill not found');
    return versions;
  });
}
