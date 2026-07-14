import { z } from 'zod';
import { Finding, Verdict } from './findings.js';

export const ReviewDiffRequest = z.object({ diff: z.string().min(1) });
export type ReviewDiffRequest = z.infer<typeof ReviewDiffRequest>;

export const AgentReviewResult = z.object({
  agent: z.object({ id: z.string(), name: z.string() }),
  verdict: Verdict, // Review.verdict is always present (non-null)
  score: z.number().int().min(0).max(100),
  blockers: z.number().int().min(0),
  findings: z.array(Finding),
});
export type AgentReviewResult = z.infer<typeof AgentReviewResult>;

// The endpoint returns the array directly (no wrapper object) — matches the
// decided response shape. fastify-type-provider-zod serializes a top-level array.
export const ReviewDiffResponse = z.array(AgentReviewResult);
export type ReviewDiffResponse = z.infer<typeof ReviewDiffResponse>;
