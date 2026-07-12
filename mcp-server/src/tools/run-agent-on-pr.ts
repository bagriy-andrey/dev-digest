/**
 * Tool `run_agent_on_pr` — the "result, not operation" tool. Resolves
 * repo/pr/agent, triggers a real (paid) LLM review run, polls until the run
 * settles, then fetches and maps the persisted review — all inside one tool
 * call, so a caller never has to orchestrate polling itself.
 *
 * Non-read-only: this is the one tool in the package that mutates server
 * state (starts a background LLM run).
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Config } from '../config.js';
import type { ApiClient } from '../api/client.js';
import { ForwardError } from '../errors.js';
import { resolveAgent, resolvePr, resolveRepo } from '../resolvers.js';
import { pollRunUntilDone } from '../poll.js';
import { pickReviewForRun, toReviewResult } from '../mappers.js';
import { ReviewResultOutput, RunAgentOnPrInput } from '../schemas.js';

const DESCRIPTION =
  'Run a configured review agent on a pull request and return the final verdict and findings. Triggers a real LLM review, waits for it to finish, and returns the result in one call — no separate polling needed. `repo` is "owner/name", `pr` is the GitHub PR number, `agent` is a name from list_agents (its id also works).';

export function registerRunAgentOnPr(server: McpServer, client: ApiClient, config: Config): void {
  server.registerTool(
    'run_agent_on_pr',
    {
      description: DESCRIPTION,
      inputSchema: RunAgentOnPrInput,
      outputSchema: ReviewResultOutput,
      annotations: {
        readOnlyHint: false,
        idempotentHint: false,
        destructiveHint: false,
        openWorldHint: true,
      },
    },
    async ({ repo, pr, agent }) => {
      try {
        const { repoId } = await resolveRepo(client, repo);
        const { prId } = await resolvePr(client, repoId, pr);
        const { agentId } = await resolveAgent(client, agent);

        const triggerResponse = await client.triggerReview(prId, agentId);
        const runId = triggerResponse.runs[0]?.run_id;
        if (!runId) {
          throw new ForwardError(
            'Review trigger did not return a run id. Call get_findings shortly to check whether a review is in progress.',
            'get_findings',
          );
        }

        const run = await pollRunUntilDone(client, prId, runId, {
          intervalMs: config.pollIntervalMs,
          timeoutMs: config.runTimeoutMs,
        });

        if (run.status === 'failed') {
          throw new ForwardError(
            `Review run failed${run.error ? `: ${run.error}` : '.'} Call get_findings to check for any partial result.`,
            'get_findings',
          );
        }

        const reviews = await client.listReviews(prId);
        const review = pickReviewForRun(reviews, runId);
        if (!review) {
          throw new ForwardError(
            'Run completed but no review was found for this PR yet. Call get_findings shortly to check again.',
            'get_findings',
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
