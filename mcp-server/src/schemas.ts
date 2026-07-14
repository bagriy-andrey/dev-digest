/**
 * Zod raw-shape input/output schemas for all 5 tools.
 *
 * The MCP SDK's `registerTool` takes a raw zod SHAPE object (`{key: ZodType}`),
 * NOT a `z.object(...)` wrapper — every per-tool schema below is exported as a
 * plain shape so `tools/*.ts` (steps 4-6) can spread it directly into a
 * `registerTool({ inputSchema: SomeInput, ... })` call. Each shape also has a
 * `z.object(shape)`-derived companion type exported alongside it, so either a
 * shape-spread usage or a wrapped-object usage works without re-deriving types.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Shared flat-arg primitives
// ---------------------------------------------------------------------------

/** `"owner/name"` — validated before being used to resolve a repo id. */
export const repoArg = z
  .string()
  .regex(/^[\w.-]+\/[\w.-]+$/, 'expected "owner/name"');

/** A positive PR number (not a UUID — resolved to one via `resolvers.ts`). */
export const prArg = z.number().int().positive();

/** An agent name or UUID (resolved via `resolvers.ts`). */
export const agentArg = z.string().min(1);

// ---------------------------------------------------------------------------
// Per-tool input schemas (raw shapes)
// ---------------------------------------------------------------------------

/** `list_agents` — no input. */
export const ListAgentsInput = {} satisfies z.ZodRawShape;
export type ListAgentsInput = z.infer<z.ZodObject<typeof ListAgentsInput>>;

/** `run_agent_on_pr` — triggers a real, paid LLM run. */
export const RunAgentOnPrInput = {
  repo: repoArg,
  pr: prArg,
  agent: agentArg,
} satisfies z.ZodRawShape;
export type RunAgentOnPrInput = z.infer<z.ZodObject<typeof RunAgentOnPrInput>>;

/** `get_findings` — `agent` is optional (falls back to newest review). */
export const GetFindingsInput = {
  repo: repoArg,
  pr: prArg,
  agent: agentArg.optional(),
} satisfies z.ZodRawShape;
export type GetFindingsInput = z.infer<z.ZodObject<typeof GetFindingsInput>>;

/** `get_conventions`. */
export const GetConventionsInput = {
  repo: repoArg,
} satisfies z.ZodRawShape;
export type GetConventionsInput = z.infer<z.ZodObject<typeof GetConventionsInput>>;

/** `get_blast_radius` — pure stub, no HTTP call, but still validates its args. */
export const GetBlastRadiusInput = {
  repo: repoArg,
  pr: prArg,
} satisfies z.ZodRawShape;
export type GetBlastRadiusInput = z.infer<z.ZodObject<typeof GetBlastRadiusInput>>;

// ---------------------------------------------------------------------------
// Output schemas
// ---------------------------------------------------------------------------

/** Slim finding shape — mirrors `PrFindingSummary`, drops id/suggestion/evidence/etc. */
export const ReviewFindingSchema = z.object({
  severity: z.enum(['CRITICAL', 'WARNING', 'SUGGESTION']),
  category: z.enum(['bug', 'security', 'perf', 'style', 'test']),
  title: z.string(),
  file: z.string(),
  start_line: z.number().int(),
  end_line: z.number().int(),
  confidence: z.number().min(0).max(1),
  rationale: z.string(),
});
export type ReviewFinding = z.infer<typeof ReviewFindingSchema>;

/** Concise review result — output shape for `run_agent_on_pr` and `get_findings`. */
export const ReviewResultSchema = z.object({
  verdict: z.enum(['request_changes', 'approve', 'comment']).nullable(),
  findings: z.array(ReviewFindingSchema),
});
export type ReviewResult = z.infer<typeof ReviewResultSchema>;

/** Raw shape form of `ReviewResultSchema`, for tools that need it spread. */
export const ReviewResultOutput = ReviewResultSchema.shape;

/** `list_agents` output entry. */
export const AgentSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  provider: z.string(),
  model: z.string(),
  enabled: z.boolean(),
});
export type AgentSummary = z.infer<typeof AgentSummarySchema>;

/** `get_conventions` output entry. */
export const ConventionSummarySchema = z.object({
  rule: z.string(),
  evidence_path: z.string(),
  evidence_line: z.number().int().optional(),
  confidence: z.number().min(0).max(1),
});
export type ConventionSummary = z.infer<typeof ConventionSummarySchema>;

/** `get_blast_radius` — fixed stub payload, no real HTTP call. */
export const BlastRadiusOutputSchema = z.object({
  status: z.literal('not_implemented'),
  message: z.string(),
  hint: z.string(),
});
export type BlastRadiusOutput = z.infer<typeof BlastRadiusOutputSchema>;
