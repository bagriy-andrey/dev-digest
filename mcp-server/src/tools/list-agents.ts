/**
 * Tool `list_agents` — lists reviewer agents configured in this DevDigest
 * workspace. Read-only, idempotent; calls `GET /agents` via the injected
 * `ApiClient` port. This is the discovery entry point for `run_agent_on_pr`
 * and `get_findings`, which both take an `agent` name/id argument.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ApiClient } from '../api/client.js';
import { toAgentSummary } from '../mappers.js';
import { AgentSummarySchema, ListAgentsInput } from '../schemas.js';
import { z } from 'zod';

const OutputSchema = {
  agents: z.array(AgentSummarySchema),
} satisfies z.ZodRawShape;

export function registerListAgents(server: McpServer, client: ApiClient): void {
  server.registerTool(
    'list_agents',
    {
      description:
        'List reviewer agents configured in this DevDigest workspace. Returns id, name, description, provider, and model for each. Call this first to get a valid `agent` name/id for run_agent_on_pr or get_findings.',
      inputSchema: ListAgentsInput,
      outputSchema: OutputSchema,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async () => {
      const agents = (await client.listAgents()).map(toAgentSummary);
      return {
        content: [{ type: 'text', text: `${agents.length} agent(s) configured.` }],
        structuredContent: { agents },
      };
    },
  );
}
