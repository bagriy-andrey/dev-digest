import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { AgentRunEstimate, MultiAgentGroupSummary, MultiAgentRun, RunRequest } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { MULTI_AGENT_RATE_LIMIT, RECENT_GROUPS_LIMIT } from './constants.js';
import { MultiAgentService } from './service.js';

/**
 * Multi-Agent Review module (SPEC-04).
 *   POST /pulls/:id/multi-agent-run  {agentId} | {all:true} | {agentIds:[...]} → start a group (rate-limited — AC-17)
 *   GET  /pulls/:id/multi-agent      → the latest group for this PR, or null (D7)
 *   GET  /multi-agent/recent         → the N most recent groups anywhere in the workspace (lightweight)
 *   GET  /multi-agent/estimates      → workspace-wide per-agent pre-run estimates (AC-8)
 *
 * Every route is workspace-scoped via `getContext`. A bare group id is never
 * trusted for tenancy — the group is always resolved through the
 * workspace-scoped PR/group queries in the service/repository.
 */
export default async function multiAgentRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const getService = () => new MultiAgentService(container);

  app.post(
    '/pulls/:id/multi-agent-run',
    {
      schema: { params: IdParams, body: RunRequest, response: { 200: MultiAgentRun } },
      // Cost-amplifying: one call starts N paid LLM runs (AC-17).
      config: { rateLimit: MULTI_AGENT_RATE_LIMIT },
    },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return getService().start(workspaceId, req.params.id, req.body, req.log);
    },
  );

  app.get(
    '/pulls/:id/multi-agent',
    { schema: { params: IdParams, response: { 200: MultiAgentRun.nullable() } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return getService().latest(workspaceId, req.params.id, req.log);
    },
  );

  app.get(
    '/multi-agent/recent',
    { schema: { response: { 200: z.array(MultiAgentGroupSummary) } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return getService().recentForWorkspace(workspaceId, RECENT_GROUPS_LIMIT, req.log);
    },
  );

  app.get(
    '/multi-agent/estimates',
    { schema: { response: { 200: z.array(AgentRunEstimate) } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return getService().estimates(workspaceId);
    },
  );
}
