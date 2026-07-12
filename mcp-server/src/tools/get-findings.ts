/**
 * Tool `get_findings` — read-only lookup of the most recent completed review
 * for a PR. Never triggers a new run. Same output shape as `run_agent_on_pr`
 * so a caller can use either interchangeably once a review exists.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ApiClient } from '../api/client.js';
import { ForwardError } from '../errors.js';
import { resolveAgent, resolvePr, resolveRepo } from '../resolvers.js';
import { toReviewResult } from '../mappers.js';
import { GetFindingsInput, ReviewResultOutput } from '../schemas.js';

const DESCRIPTION =
  "Get the most recent completed review result for a pull request without starting a new run. Same shape as run_agent_on_pr's result. Use this after run_agent_on_pr, or to check whether a PR already has a review.";

export function registerGetFindings(server: McpServer, client: ApiClient): void {
  server.registerTool(
    'get_findings',
    {
      description: DESCRIPTION,
      inputSchema: GetFindingsInput,
      outputSchema: ReviewResultOutput,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ repo, pr, agent }) => {
      try {
        const { repoId } = await resolveRepo(client, repo);
        const { prId } = await resolvePr(client, repoId, pr);

        let agentId: string | undefined;
        if (agent) {
          const resolved = await resolveAgent(client, agent);
          agentId = resolved.agentId;
        }

        const reviews = await client.listReviews(prId);
        // `GET /pulls/:id/reviews` returns newest-first (spec §0), so the
        // first match (optionally filtered by resolved agent) is the newest.
        const review = agentId ? reviews.find((r) => r.agent_id === agentId) : reviews[0];

        if (!review) {
          throw new ForwardError(
            'No review found for this PR yet. Call run_agent_on_pr to create one.',
            'run_agent_on_pr',
          );
        }

        const result = toReviewResult(review);
        return {
          content: [{ type: 'text', text: `${result.verdict} — ${result.findings.length} finding(s).` }],
          structuredContent: result,
        };
      } catch (err) {
        if (err instanceof ForwardError) {
          return err.toToolResult();
        }
        throw err;
      }
    },
  );
}
