/**
 * Entry point (`bin`). Wires a `StdioServerTransport` onto the composition
 * root built by `server.ts` and connects it.
 *
 * STDOUT HYGIENE: the stdio transport uses stdout as the JSON-RPC wire
 * format. NEVER `console.log` (or otherwise write to stdout) anywhere in
 * this process — it corrupts the protocol stream for whatever MCP client is
 * reading it. All diagnostics MUST go to stderr (`console.error`).
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig } from './config.js';
import { createMcpServer } from './server.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const server = createMcpServer(config);
  const transport = new StdioServerTransport();

  await server.connect(transport);

  console.error(`devdigest-mcp-server listening on stdio (api=${config.apiUrl})`);
}

main().catch((error) => {
  console.error('devdigest-mcp-server failed to start:', error);
  process.exit(1);
});
