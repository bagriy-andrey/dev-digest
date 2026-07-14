/**
 * Tool: `get_blast_radius` — PURE STUB.
 *
 * No blast-radius endpoint exists yet on `@devdigest/api` (spec §0 — `blast` is
 * only a future course-lesson module). This handler makes ZERO HTTP calls and
 * does not even receive an `ApiClient` — it always returns the same fixed
 * `not_implemented` payload, regardless of the (still-validated) input.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { GetBlastRadiusInput, BlastRadiusOutputSchema } from '../schemas.js';

/** Raw-shape output: `registerTool`'s `outputSchema` wants a shape, not a `z.object(...)`. */
const GetBlastRadiusOutput = BlastRadiusOutputSchema.shape;

const STUB_RESULT = {
  status: 'not_implemented' as const,
  message: 'Blast-radius analysis is not implemented yet.',
  hint: 'Use get_conventions or get_findings for context on this repo/PR in the meantime.',
};

export function registerGetBlastRadius(server: McpServer): void {
  server.registerTool(
    'get_blast_radius',
    {
      description:
        'STUB — not implemented yet. Always returns a fixed not_implemented response pointing at get_conventions or get_findings instead. Will eventually return the files/callers affected by a PR\'s changes.',
      inputSchema: GetBlastRadiusInput,
      outputSchema: GetBlastRadiusOutput,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (_input) => {
      return {
        content: [{ type: 'text', text: 'not_implemented' }],
        structuredContent: STUB_RESULT,
      };
    },
  );
}
