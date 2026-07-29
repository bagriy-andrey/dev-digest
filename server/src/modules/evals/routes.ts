import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  EvalCase,
  EvalCaseInput,
  EvalBatchStart,
  EvalBatchStartAll,
  EvalBatchSummary,
  EvalCompare,
  EvalDashboard,
  EvalRunRecord,
  EvalWorkspaceDashboard,
} from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError } from '../../platform/errors.js';
import { EvalCaseService } from './case-service.js';
import { EvalRunner } from './runner.js';
import { EvalDashboardService } from './dashboard-service.js';

/**
 * evals module (SPEC-03).
 *   GET    /agents/:id/eval-cases
 *   POST   /agents/:id/eval-cases
 *   PUT    /eval-cases/:id
 *   DELETE /eval-cases/:id
 *   POST   /findings/:id/eval-case
 *   POST   /eval-cases/:id/run          ⚡ rate-limited
 *   POST   /agents/:id/eval-runs        ⚡ rate-limited
 *   POST   /eval-runs                   ⚡ rate-limited (all agents)
 *   GET    /agents/:id/eval-runs
 *   GET    /eval-batches/compare        (registered BEFORE /eval-batches/:batchId — D8)
 *   GET    /eval-batches/:batchId
 *   GET    /agents/:id/eval-dashboard
 *   GET    /eval-dashboard
 *
 * Every route is workspace-scoped via `getContext`. `owner_kind`/`owner_id`
 * for a case are always derived from the route path, never trusted from the
 * request body (spec API table).
 */

const RUN_RATE_LIMIT = { max: 10, timeWindow: '1 minute' } as const;

const BatchIdParams = z.object({ batchId: z.string().uuid() });
const RunsQuery = z.object({ batch_id: z.string().uuid().optional() });
const CompareQuery = z.object({ a: z.string().uuid(), b: z.string().uuid() });

export default async function evalsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;

  const cases = new EvalCaseService(container);
  const runner = new EvalRunner(container);
  const dashboard = new EvalDashboardService(container);

  // ---- Cases ---------------------------------------------------------

  app.get(
    '/agents/:id/eval-cases',
    { schema: { params: IdParams, response: { 200: z.array(EvalCase) } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return cases.list(workspaceId, 'agent', req.params.id);
    },
  );

  app.post(
    '/agents/:id/eval-cases',
    { schema: { params: IdParams, body: EvalCaseInput, response: { 201: EvalCase } } },
    async (req, reply) => {
      const { workspaceId } = await getContext(container, req);
      const created = await cases.create(workspaceId, 'agent', req.params.id, req.body);
      reply.status(201);
      return created;
    },
  );

  app.put(
    '/eval-cases/:id',
    { schema: { params: IdParams, body: EvalCaseInput, response: { 200: EvalCase } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      const updated = await cases.update(workspaceId, req.params.id, req.body);
      if (!updated) throw new NotFoundError('Eval case not found');
      return updated;
    },
  );

  app.delete('/eval-cases/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    const ok = await cases.delete(workspaceId, req.params.id);
    return { ok };
  });

  app.post(
    '/findings/:id/eval-case',
    { schema: { params: IdParams, response: { 200: EvalCase, 201: EvalCase } } },
    async (req, reply) => {
      const { workspaceId } = await getContext(container, req);
      const { evalCase, created } = await cases.createFromFinding(workspaceId, req.params.id);
      reply.status(created ? 201 : 200);
      return evalCase;
    },
  );

  // ---- Running (cost-amplifying — rate-limited) -----------------------

  app.post(
    '/eval-cases/:id/run',
    {
      schema: { params: IdParams, response: { 202: EvalBatchStart } },
      config: { rateLimit: RUN_RATE_LIMIT },
    },
    async (req, reply) => {
      const { workspaceId } = await getContext(container, req);
      const started = await runner.runSingleCase(workspaceId, req.params.id);
      reply.status(202);
      return started;
    },
  );

  app.post(
    '/agents/:id/eval-runs',
    {
      schema: { params: IdParams, response: { 202: EvalBatchStart } },
      config: { rateLimit: RUN_RATE_LIMIT },
    },
    async (req, reply) => {
      const { workspaceId } = await getContext(container, req);
      const started = await runner.startBatch(workspaceId, req.params.id);
      reply.status(202);
      return started;
    },
  );

  app.post(
    '/eval-runs',
    {
      schema: { response: { 202: EvalBatchStartAll } },
      config: { rateLimit: RUN_RATE_LIMIT },
    },
    async (req, reply) => {
      const { workspaceId } = await getContext(container, req);
      const started = await runner.startAllAgents(workspaceId);
      reply.status(202);
      return started;
    },
  );

  // ---- Reads -----------------------------------------------------------

  app.get(
    '/agents/:id/eval-runs',
    {
      schema: { params: IdParams, querystring: RunsQuery, response: { 200: z.array(EvalRunRecord) } },
    },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return runner.listRuns(workspaceId, req.params.id, req.query.batch_id);
    },
  );

  // D8 — register the static `compare` route BEFORE the parameterised
  // `:batchId` one, for readability (find-my-way already resolves static
  // segments first regardless).
  app.get(
    '/eval-batches/compare',
    { schema: { querystring: CompareQuery, response: { 200: EvalCompare } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      const result = await dashboard.compare(workspaceId, req.query.a, req.query.b);
      if (!result) throw new NotFoundError('One or both batches not found');
      return result;
    },
  );

  app.get(
    '/eval-batches/:batchId',
    {
      schema: {
        params: BatchIdParams,
        response: { 200: EvalBatchSummary.extend({ runs: z.array(EvalRunRecord) }) },
      },
    },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      const result = await dashboard.batchSummary(workspaceId, req.params.batchId);
      if (!result) throw new NotFoundError('Eval batch not found');
      return { ...result.summary, runs: result.runs };
    },
  );

  app.get(
    '/agents/:id/eval-dashboard',
    { schema: { params: IdParams, response: { 200: EvalDashboard } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      const result = await dashboard.agentDashboard(workspaceId, req.params.id);
      if (!result) throw new NotFoundError('Agent not found');
      return result;
    },
  );

  app.get(
    '/eval-dashboard',
    { schema: { response: { 200: EvalWorkspaceDashboard } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return dashboard.workspaceDashboard(workspaceId);
    },
  );
}
