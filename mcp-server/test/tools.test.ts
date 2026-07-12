/**
 * Unit tests for the 5 tool handlers (`src/tools/*.ts`), each exercised
 * against a mock `ApiClient` — no live server.
 *
 * A `registerXxx(server, ...)` function has no return value; the tool
 * handler it installs lives inside the `McpServer` instance's internal tool
 * registry. `RegisteredTool.handler` (`node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.js`,
 * `_createRegisteredTool`) stores the exact callback passed to
 * `registerTool(...)` with no wrapping, so calling it directly:
 *   - skips the SDK's top-level `CallToolRequestSchema` dispatcher, which
 *     means it also skips that dispatcher's input-zod-parsing AND its
 *     outer try/catch that turns a thrown error into an `isError` result.
 *     Handlers that wrap their own body in try/catch (`run_agent_on_pr`,
 *     `get_findings`) still return an `isError` `ForwardErrorToolResult`
 *     directly; handlers that don't (`get_conventions`, `list_agents`)
 *     instead REJECT the returned promise with the raw `ForwardError` when
 *     called this way — both are asserted below, matching each tool's own
 *     source.
 *   - requires supplying valid, already-shaped args ourselves (since zod
 *     parsing is bypassed) and a minimal `extra` stub satisfying the
 *     handler's second parameter, which none of these 5 handlers read.
 *
 * `_registeredTools` is a private field on `McpServer` in the SDK's type
 * defs, but not actually private at runtime (plain JS) — reached into via
 * a narrow cast rather than duplicating the SDK's dispatch machinery.
 */
import { describe, expect, it, vi } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { ApiClient } from '../src/api/client.js';
import type {
  AgentDto,
  ConventionDto,
  PrMetaDto,
  RepoDto,
  ReviewDto,
  RunSummaryDto,
  RunTriggerResponse,
} from '../src/api/types.js';
import type { Config } from '../src/config.js';
import { ForwardError } from '../src/errors.js';

import { registerListAgents } from '../src/tools/list-agents.js';
import { registerRunAgentOnPr } from '../src/tools/run-agent-on-pr.js';
import { registerGetFindings } from '../src/tools/get-findings.js';
import { registerGetConventions } from '../src/tools/get-conventions.js';
import { registerGetBlastRadius } from '../src/tools/get-blast-radius.js';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Plain object mock of `ApiClient` — one `vi.fn()` per method, per repo convention. */
function mockClient(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    listRepos: vi.fn(async () => []),
    listPulls: vi.fn(async () => []),
    listAgents: vi.fn(async () => []),
    triggerReview: vi.fn(),
    listRuns: vi.fn(async () => []),
    listReviews: vi.fn(async () => []),
    listConventions: vi.fn(async () => []),
    ...overrides,
  };
}

/** Loose shape covering every tool handler's return value, avoids importing SDK result types. */
type ToolHandlerResult = {
  content: { type: string; text: string }[];
  structuredContent?: unknown;
  isError?: boolean;
};

type ToolHandler = (args: unknown, extra: unknown) => Promise<ToolHandlerResult>;

/** Minimal stub for the SDK's `RequestHandlerExtra` — none of these 5 handlers read it. */
function fakeExtra(): unknown {
  return {
    signal: new AbortController().signal,
    requestId: 'test-request',
    sendNotification: vi.fn(async () => {}),
    sendRequest: vi.fn(async () => {
      throw new Error('sendRequest is not supported in this unit test');
    }),
  };
}

/** Reach into the (runtime-public, type-private) internal tool registry set up by `registerTool`. */
function getToolHandler(server: McpServer, name: string): ToolHandler {
  const registry = (server as unknown as { _registeredTools: Record<string, { handler: ToolHandler } | undefined> })
    ._registeredTools;
  const tool = registry[name];
  if (!tool) {
    throw new Error(`tool "${name}" was not registered`);
  }
  return tool.handler;
}

async function callTool(server: McpServer, name: string, args: unknown): Promise<ToolHandlerResult> {
  const handler = getToolHandler(server, name);
  return handler(args, fakeExtra());
}

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const repo: RepoDto = { id: 'repo-1', owner: 'acme', name: 'widgets', full_name: 'acme/widgets' };

const pr: PrMetaDto = {
  id: 'pr-1',
  number: 42,
  title: 'Add feature',
  author: 'alice',
  branch: 'feat',
  base: 'main',
  status: 'open',
};

const agent: AgentDto = {
  id: '11111111-1111-1111-1111-111111111111',
  name: 'security-reviewer',
  description: 'Finds security issues',
  provider: 'openai',
  model: 'gpt-4.1',
  enabled: true,
};

const RUN_ID = 'run-1';

const review: ReviewDto = {
  id: 'review-1',
  pr_id: pr.id as string,
  run_id: RUN_ID,
  agent_id: agent.id,
  verdict: 'approve',
  summary: 'Looks good',
  score: 0.95,
  findings: [
    {
      id: 'finding-1',
      severity: 'WARNING',
      category: 'style',
      title: 'Missing doc comment',
      file: 'src/index.ts',
      start_line: 10,
      end_line: 12,
      confidence: 0.8,
      rationale: 'Public export lacks a doc comment.',
    },
  ],
};

const conventionCandidate: ConventionDto = {
  id: 'conv-1',
  rule: 'Use kebab-case for file names',
  evidence_path: 'src/foo-bar.ts',
  evidence_line: 1,
  evidence_snippet: 'export const fooBar',
  confidence: 0.7,
  accepted: false,
};

function newServer(): McpServer {
  return new McpServer({ name: 'devdigest-test', version: '0.0.0' });
}

// ---------------------------------------------------------------------------
// list_agents
// ---------------------------------------------------------------------------

describe('list_agents', () => {
  it('happy path: returns the mapped agent summaries', async () => {
    const client = mockClient({ listAgents: vi.fn(async () => [agent]) });
    const server = newServer();
    registerListAgents(server, client);

    const result = await callTool(server, 'list_agents', {});

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({
      agents: [
        {
          id: agent.id,
          name: agent.name,
          description: agent.description,
          provider: agent.provider,
          model: agent.model,
          enabled: agent.enabled,
        },
      ],
    });
    expect(client.listAgents).toHaveBeenCalledTimes(1);
  });

  it('empty agent list is a valid (non-error) result', async () => {
    const client = mockClient({ listAgents: vi.fn(async () => []) });
    const server = newServer();
    registerListAgents(server, client);

    const result = await callTool(server, 'list_agents', {});

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({ agents: [] });
  });
});

// ---------------------------------------------------------------------------
// run_agent_on_pr
// ---------------------------------------------------------------------------

describe('run_agent_on_pr', () => {
  const config: Config = {
    apiUrl: 'http://localhost:9999',
    runTimeoutMs: 5_000,
    pollIntervalMs: 1,
    httpTimeoutMs: 1_000,
  };

  it('happy path: resolves, triggers, polls through running -> done, and returns the review', async () => {
    let listRunsCalls = 0;
    const runningRun: RunSummaryDto = {
      run_id: RUN_ID,
      agent_id: agent.id,
      agent_name: agent.name,
      status: 'running',
      error: null,
      findings_count: null,
      score: null,
    };
    const doneRun: RunSummaryDto = {
      ...runningRun,
      status: 'done',
      findings_count: 1,
      score: 0.95,
    };

    const triggerResponse: RunTriggerResponse = {
      pr_id: pr.id as string,
      runs: [{ run_id: RUN_ID, agent_id: agent.id, agent_name: agent.name }],
      reviews: [],
    };

    const client = mockClient({
      listRepos: vi.fn(async () => [repo]),
      listPulls: vi.fn(async () => [pr]),
      listAgents: vi.fn(async () => [agent]),
      triggerReview: vi.fn(async () => triggerResponse),
      // running for the first 2 polls, done on the 3rd — exercises the actual poll loop.
      listRuns: vi.fn(async () => {
        listRunsCalls += 1;
        return [listRunsCalls < 3 ? runningRun : doneRun];
      }),
      listReviews: vi.fn(async () => [review]),
    });

    const server = newServer();
    registerRunAgentOnPr(server, client, config);

    const result = await callTool(server, 'run_agent_on_pr', {
      repo: 'acme/widgets',
      pr: 42,
      agent: 'security-reviewer',
    });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({
      verdict: 'approve',
      findings: [
        {
          severity: 'WARNING',
          category: 'style',
          title: 'Missing doc comment',
          file: 'src/index.ts',
          start_line: 10,
          end_line: 12,
          confidence: 0.8,
          rationale: 'Public export lacks a doc comment.',
        },
      ],
    });
    expect(client.triggerReview).toHaveBeenCalledWith('pr-1', agent.id);
    expect(listRunsCalls).toBeGreaterThanOrEqual(3);
  });

  it('forward-error path: unknown repo surfaces a ForwardError result naming the recovery step', async () => {
    const client = mockClient({ listRepos: vi.fn(async () => []) });
    const server = newServer();
    registerRunAgentOnPr(server, client, config);

    const result = await callTool(server, 'run_agent_on_pr', {
      repo: 'acme/missing',
      pr: 42,
      agent: 'security-reviewer',
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(
      /Repo "acme\/missing" not found\. Check the spelling, or ask the user which repos are imported\./,
    );
    expect(result.content[0]?.text).toMatch(/next: double check the repo argument/);
  });
});

// ---------------------------------------------------------------------------
// get_findings
// ---------------------------------------------------------------------------

describe('get_findings', () => {
  it('happy path: returns the newest review for the resolved PR', async () => {
    const client = mockClient({
      listRepos: vi.fn(async () => [repo]),
      listPulls: vi.fn(async () => [pr]),
      listReviews: vi.fn(async () => [review]),
    });
    const server = newServer();
    registerGetFindings(server, client);

    const result = await callTool(server, 'get_findings', { repo: 'acme/widgets', pr: 42 });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({
      verdict: 'approve',
      findings: [
        {
          severity: 'WARNING',
          category: 'style',
          title: 'Missing doc comment',
          file: 'src/index.ts',
          start_line: 10,
          end_line: 12,
          confidence: 0.8,
          rationale: 'Public export lacks a doc comment.',
        },
      ],
    });
  });

  it('forward-error path: no review yet surfaces a ForwardError naming run_agent_on_pr', async () => {
    const client = mockClient({
      listRepos: vi.fn(async () => [repo]),
      listPulls: vi.fn(async () => [pr]),
      listReviews: vi.fn(async () => []),
    });
    const server = newServer();
    registerGetFindings(server, client);

    const result = await callTool(server, 'get_findings', { repo: 'acme/widgets', pr: 42 });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/No review found for this PR yet\. Call run_agent_on_pr to create one\./);
    expect(result.content[0]?.text).toMatch(/next: run_agent_on_pr/);
  });
});

// ---------------------------------------------------------------------------
// get_conventions
// ---------------------------------------------------------------------------

describe('get_conventions', () => {
  it('happy path: returns the mapped convention candidates', async () => {
    const client = mockClient({
      listRepos: vi.fn(async () => [repo]),
      listConventions: vi.fn(async () => [conventionCandidate]),
    });
    const server = newServer();
    registerGetConventions(server, client);

    const result = await callTool(server, 'get_conventions', { repo: 'acme/widgets' });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({
      conventions: [
        {
          rule: conventionCandidate.rule,
          evidence_path: conventionCandidate.evidence_path,
          evidence_line: conventionCandidate.evidence_line,
          confidence: conventionCandidate.confidence,
        },
      ],
    });
  });

  it('forward-error path: unknown repo rejects with the ForwardError (no internal try/catch here)', async () => {
    const client = mockClient({ listRepos: vi.fn(async () => []) });
    const server = newServer();
    registerGetConventions(server, client);

    await expect(callTool(server, 'get_conventions', { repo: 'acme/missing' })).rejects.toThrow(ForwardError);
    await expect(callTool(server, 'get_conventions', { repo: 'acme/missing' })).rejects.toThrow(
      /Repo "acme\/missing" not found\. Check the spelling, or ask the user which repos are imported\./,
    );
  });
});

// ---------------------------------------------------------------------------
// get_blast_radius
// ---------------------------------------------------------------------------

describe('get_blast_radius', () => {
  it('returns the fixed not_implemented stub and calls no ApiClient method', async () => {
    // Constructed purely to prove nothing on it gets invoked — registerGetBlastRadius
    // takes no `client` parameter at all, so this can never be wired up to anything.
    const client = mockClient();
    const server = newServer();
    registerGetBlastRadius(server);

    const result = await callTool(server, 'get_blast_radius', { repo: 'acme/widgets', pr: 42 });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({
      status: 'not_implemented',
      message: 'Blast-radius analysis is not implemented yet.',
      hint: 'Use get_conventions or get_findings for context on this repo/PR in the meantime.',
    });

    for (const fn of Object.values(client)) {
      expect(fn as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
    }
  });
});
