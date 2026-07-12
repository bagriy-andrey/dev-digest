/**
 * Tool: `get_conventions` — read-only.
 *
 * Resolves `repo` ("owner/name") to a server-issued repo id, then lists this
 * repo's extracted coding conventions (`GET /repos/:id/conventions`). An empty
 * result is a normal, successful outcome (repo-intel degrades silently on an
 * unindexed repo, per spec §0) — never thrown as an error.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ApiClient } from '../api/client.js';
import { GetConventionsInput, ConventionSummarySchema } from '../schemas.js';
import { resolveRepo } from '../resolvers.js';
import { toConventionSummary } from '../mappers.js';

/** Raw-shape output: `registerTool`'s `outputSchema` wants a shape, not a `z.object(...)`. */
const GetConventionsOutput = {
  conventions: z.array(ConventionSummarySchema),
};

export function registerGetConventions(server: McpServer, client: ApiClient): void {
  server.registerTool(
    'get_conventions',
    {
      description:
        "Get this repo's extracted coding conventions — rules inferred from the codebase with file evidence. An empty list means the repo hasn't been indexed for conventions yet, not an error.",
      inputSchema: GetConventionsInput,
      outputSchema: GetConventionsOutput,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ repo }) => {
      const { repoId } = await resolveRepo(client, repo);
      const candidates = await client.listConventions(repoId);
      const conventions = candidates.map(toConventionSummary);
      const structuredContent = { conventions };
      return {
        content: [{ type: 'text', text: `${conventions.length} convention(s) found.` }],
        structuredContent,
      };
    },
  );
}
