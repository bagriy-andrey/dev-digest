import type { Config } from '../config.js';
import { ForwardError } from '../errors.js';
import type { ApiClient } from './client.js';
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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Injection-sink guard (spec §5 Security): every value interpolated into a
 * URL path segment MUST already be a server-issued UUID (resolved from a
 * name/number by `resolvers.ts`, never a raw caller-supplied string). This
 * throws BEFORE any request is made if that invariant is violated, which
 * blocks path traversal / SSRF via a crafted tool argument (e.g. a `repoId`
 * of `"../../admin"` or a URL).
 */
function assertUuid(value: string, label: string): string {
  if (!UUID_RE.test(value)) {
    throw new Error(`Invalid ${label}: expected a UUID, got ${JSON.stringify(value)}`);
  }
  return value;
}

/**
 * `HttpApiClient` — the concrete fetch ADAPTER for the `ApiClient` port.
 * Talks to the already-running `@devdigest/api` over plain HTTP; no auth
 * header is sent (the server resolves a default workspace regardless — see
 * spec §0).
 */
export class HttpApiClient implements ApiClient {
  constructor(private readonly config: Config) {}

  async listRepos(): Promise<RepoDto[]> {
    return this.request<RepoDto[]>('GET', '/repos');
  }

  async listPulls(repoId: string): Promise<PrMetaDto[]> {
    assertUuid(repoId, 'repoId');
    return this.request<PrMetaDto[]>('GET', `/repos/${repoId}/pulls`, undefined, 'Repo');
  }

  async listAgents(): Promise<AgentDto[]> {
    return this.request<AgentDto[]>('GET', '/agents');
  }

  async triggerReview(prId: string, agentId: string): Promise<RunTriggerResponse> {
    assertUuid(prId, 'prId');
    assertUuid(agentId, 'agentId');
    return this.request<RunTriggerResponse>(
      'POST',
      `/pulls/${prId}/review`,
      { agentId },
      'Pull request',
    );
  }

  async listRuns(prId: string): Promise<RunSummaryDto[]> {
    assertUuid(prId, 'prId');
    return this.request<RunSummaryDto[]>('GET', `/pulls/${prId}/runs`, undefined, 'Pull request');
  }

  async listReviews(prId: string): Promise<ReviewDto[]> {
    assertUuid(prId, 'prId');
    return this.request<ReviewDto[]>('GET', `/pulls/${prId}/reviews`, undefined, 'Pull request');
  }

  async listConventions(repoId: string): Promise<ConventionDto[]> {
    assertUuid(repoId, 'repoId');
    return this.request<ConventionDto[]>(
      'GET',
      `/repos/${repoId}/conventions`,
      undefined,
      'Repo',
    );
  }

  async reviewDiff(repoId: string, diff: string): Promise<AgentReviewResult[]> {
    assertUuid(repoId, 'repoId');
    return this.request<AgentReviewResult[]>(
      'POST',
      `/repos/${repoId}/review-diff`,
      { diff },
      'Repo',
    );
  }

  /**
   * Shared fetch plumbing: per-call timeout via `AbortController`
   * (`config.httpTimeoutMs`), JSON in/out.
   *
   * `redirect: 'error'` — a redirect response (same-host or cross-host) is
   * treated as a hard failure rather than silently followed; this is the
   * simplest correct way to guarantee no cross-host redirect is ever taken
   * (spec §5 Security: "do not follow redirects to other hosts").
   *
   * Non-2xx handling: a 404 against a specific, named resource (`resourceLabel`
   * set) means the id we hold no longer resolves server-side — a genuine
   * "go back and re-resolve" situation, so it's raised as a `ForwardError`.
   * Anything else (other statuses, network failure, timeout/abort) is a plain
   * `Error` — a real infra problem, not a "call a different tool" situation.
   */
  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    resourceLabel?: string,
  ): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.httpTimeoutMs);
    try {
      const res = await fetch(`${this.config.apiUrl}${path}`, {
        method,
        redirect: 'error',
        signal: controller.signal,
        headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });

      if (!res.ok) {
        if (res.status === 404 && resourceLabel) {
          throw new ForwardError(
            `${resourceLabel} not found (404 for ${method} ${path})`,
            're-resolve the id by name and retry — it may be stale',
          );
        }
        throw new Error(`${method} ${path} failed: ${res.status} ${res.statusText}`);
      }

      return (await res.json()) as T;
    } finally {
      clearTimeout(timeout);
    }
  }
}

/** Composition-root factory: builds the concrete `ApiClient` adapter from config. */
export function createApiClient(config: Config): ApiClient {
  return new HttpApiClient(config);
}
