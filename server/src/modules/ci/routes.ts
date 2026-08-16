import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { CiExportInput, CiExport, CiInstallation, CiRun } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { CiExportService } from './export-service.js';
import { CiIngestService } from './ingest-service.js';

/**
 * modules/ci/routes.ts (SPEC-04) — Export-to-CI.
 *   POST /agents/:id/export-ci   ⚡ rate-limited (AC-18…AC-24)
 *   GET  /ci-installations       (AC-26a, AC-36, AC-37)
 *   GET  /ci-runs                (AC-40, AC-41)
 *   POST /ci-runs/refresh        ⚡ rate-limited (AC-43, AC-45…AC-53)
 *
 * Every handler is `getContext`-scoped — workspace isolation is
 * non-negotiable (AC-24). This file never calls `db.*` directly; all
 * persistence goes through `CiExportService`/`CiIngestService`.
 */

const CI_RATE_LIMIT = { max: 10, timeWindow: '1 minute' } as const;

// D5 — display fields the CI tab / CI Runs page need that the frozen
// `CiInstallation`/`CiRun` contracts don't carry, added at the route
// boundary rather than widening the vendored contract.
const CiInstallationRowSchema = CiInstallation.extend({
  agent_name: z.string().nullable(),
  latest_run: CiRun.nullable(),
});

const CiRunRowSchema = CiRun.extend({ repo: z.string().nullable() });

const CiInstallationsQuery = z.object({ agent_id: z.string().uuid().optional() });

const RUNS_LIMIT = 200;

const CiRefreshSummary = z.object({
  installationsChecked: z.number().int(),
  runsExamined: z.number().int(),
  artifactsValid: z.number().int(),
  artifactsInvalid: z.number().int(),
  artifactsMissing: z.number().int(),
  skipped: z.number().int(),
  failures: z.array(z.object({ repo: z.string(), reason: z.string() })),
});

export default async function ciRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;

  const exportService = new CiExportService(container);
  const ingestService = new CiIngestService(container);

  app.post(
    '/agents/:id/export-ci',
    {
      schema: { params: IdParams, body: CiExportInput, response: { 200: CiExport } },
      config: { rateLimit: CI_RATE_LIMIT },
    },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return exportService.export(workspaceId, req.params.id, req.body, req.log);
    },
  );

  app.get(
    '/ci-installations',
    {
      schema: {
        querystring: CiInstallationsQuery,
        response: { 200: z.array(CiInstallationRowSchema) },
      },
    },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return exportService.listInstallations(workspaceId, req.query.agent_id);
    },
  );

  app.get(
    '/ci-runs',
    { schema: { response: { 200: z.array(CiRunRowSchema) } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return exportService.listRuns(workspaceId, RUNS_LIMIT);
    },
  );

  app.post(
    '/ci-runs/refresh',
    {
      schema: { response: { 200: CiRefreshSummary } },
      config: { rateLimit: CI_RATE_LIMIT },
    },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return ingestService.refresh(workspaceId, req.log);
    },
  );
}
