/**
 * Composition root — builds the `McpServer` and wires up all 5 tools against
 * a concrete `HttpApiClient`. Deliberately does NOT touch a transport, so it
 * is unit-testable (construct + inspect) without stdio or a live process.
 * `index.ts` is the only place that connects a transport.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Config } from './config.js';
import { createApiClient } from './api/http-client.js';
import { registerListAgents } from './tools/list-agents.js';
import { registerRunAgentOnPr } from './tools/run-agent-on-pr.js';
import { registerGetFindings } from './tools/get-findings.js';
import { registerGetConventions } from './tools/get-conventions.js';
import { registerGetBlastRadius } from './tools/get-blast-radius.js';

const SERVER_NAME = 'devdigest';
const SERVER_VERSION = '0.0.0';

/**
 * Builds a fully-wired `McpServer` for the given config. Pure construction —
 * no I/O beyond what `HttpApiClient`'s methods perform when actually invoked
 * by a tool call.
 */
export function createMcpServer(config: Config): McpServer {
  const client = createApiClient(config);

  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  registerListAgents(server, client);
  registerRunAgentOnPr(server, client, config);
  registerGetFindings(server, client);
  registerGetConventions(server, client);
  registerGetBlastRadius(server);

  return server;
}
