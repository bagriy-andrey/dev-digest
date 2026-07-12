import type {
  AgentDto,
  AgentReviewResult,
  ConventionDto,
  PrMetaDto,
  RepoDto,
  ReviewDto,
  RunSummaryDto,
  RunTriggerResponse,
} from './types.js';

/**
 * `ApiClient` — the HTTP PORT (ports-and-adapters, `onion-architecture`).
 * Tool handlers and the name→id resolvers (`resolvers.ts`, `poll.ts`) depend
 * on THIS interface, never on the concrete `HttpApiClient` adapter — so they
 * stay unit-testable against a mock, with no live `@devdigest/api` needed.
 *
 * One method per existing `@devdigest/api` endpoint this package reads/calls
 * (see spec §0 — "What already exists"). No DB access, no new endpoints.
 */
export interface ApiClient {
  /** `GET /repos` — workspace-scoped repo list. */
  listRepos(): Promise<RepoDto[]>;

  /** `GET /repos/:id/pulls` — PRs for one repo (`repoId` = server-issued UUID). */
  listPulls(repoId: string): Promise<PrMetaDto[]>;

  /** `GET /agents` — configured review agents. */
  listAgents(): Promise<AgentDto[]>;

  /**
   * `POST /pulls/:id/review` body `{agentId}` — fire-and-forget trigger.
   * Returns immediately with the new run id(s); findings are NOT in this
   * response (see `RunTriggerResponse`) — poll `listRuns`/`listReviews`.
   */
  triggerReview(prId: string, agentId: string): Promise<RunTriggerResponse>;

  /** `GET /pulls/:id/runs` — full run history for a PR (poll target). */
  listRuns(prId: string): Promise<RunSummaryDto[]>;

  /** `GET /pulls/:id/reviews` — persisted reviews + findings for a PR. */
  listReviews(prId: string): Promise<ReviewDto[]>;

  /** `GET /repos/:id/conventions` — extracted repo conventions (may be `[]`). */
  listConventions(repoId: string): Promise<ConventionDto[]>;

  /**
   * `POST /repos/:id/review-diff` body `{diff}` — SYNCHRONOUS (unlike
   * `triggerReview`, the findings are directly in this response; no polling).
   * One entry per enabled agent. Used by the `devdigest review` CLI (pre-push
   * local review), not by any of the 5 stdio MCP tools.
   */
  reviewDiff(repoId: string, diff: string): Promise<AgentReviewResult[]>;
}
