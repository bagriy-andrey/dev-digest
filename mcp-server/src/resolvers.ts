/**
 * Name→UUID resolution against the `ApiClient` PORT — never a concrete
 * adapter. Every resolver takes `client: ApiClient` as a parameter so it's
 * unit-testable with a plain mock object, no live server needed.
 *
 * Each miss throws a `ForwardError` whose message names the concrete next
 * step a caller (an LLM) should take to recover — the "errors lead forward"
 * principle from `errors.ts`.
 */

import type { ApiClient } from './api/client.js';
import { ForwardError } from './errors.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Resolve `"owner/name"` to a server-issued repo id. */
export async function resolveRepo(
  client: ApiClient,
  repoArg: string,
): Promise<{ repoId: string }> {
  const [owner, name] = repoArg.split('/');
  const repos = await client.listRepos();
  const match = repos.find(
    (r) =>
      (r.owner.toLowerCase() === owner?.toLowerCase() && r.name.toLowerCase() === name?.toLowerCase()) ||
      r.full_name.toLowerCase() === repoArg.toLowerCase(),
  );
  if (!match) {
    throw new ForwardError(
      `Repo "${repoArg}" not found. Check the spelling, or ask the user which repos are imported.`,
      'double check the repo argument (owner/name) and retry',
    );
  }
  return { repoId: match.id };
}

/** Resolve a PR number (within a repo) to a server-issued PR id. */
export async function resolvePr(
  client: ApiClient,
  repoId: string,
  pr: number,
): Promise<{ prId: string }> {
  const pulls = await client.listPulls(repoId);
  const match = pulls.find((p) => p.number === pr);
  if (!match || match.id === null) {
    throw new ForwardError(
      `PR #${pr} not found in this repo. Check the PR number.`,
      'double check the PR number and retry',
    );
  }
  return { prId: match.id };
}

/**
 * Resolve an agent name OR id to `{agentId, agentName}`. Always lists agents
 * and matches on either `id` or `name` (case-insensitive) — a UUID-shaped
 * arg is matched via the `id` branch of the same comparison, so no separate
 * "treat as id directly" fast path is needed.
 */
export async function resolveAgent(
  client: ApiClient,
  agentArg: string,
): Promise<{ agentId: string; agentName: string }> {
  const agents = await client.listAgents();
  const isUuid = UUID_RE.test(agentArg);
  const match = agents.find(
    (a) =>
      (isUuid && a.id.toLowerCase() === agentArg.toLowerCase()) ||
      a.name.toLowerCase() === agentArg.toLowerCase() ||
      a.id.toLowerCase() === agentArg.toLowerCase(),
  );
  if (!match) {
    throw new ForwardError(
      `Agent "${agentArg}" not found. Call list_agents to see valid names/ids.`,
      'list_agents',
    );
  }
  return { agentId: match.id, agentName: match.name };
}
