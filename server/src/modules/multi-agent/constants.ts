/**
 * Multi-Agent Review — constants (SPEC-04).
 */

/** How many of an agent's most recent completed runs feed its estimate (AC-8). */
export const ESTIMATE_SAMPLE_SIZE = 5;

/** Severity ordering used by both column sort (AC-34) and conflict-clustering (AC-31). */
export const SEVERITY_RANK = { CRITICAL: 3, WARNING: 2, SUGGESTION: 1 } as const;

/** Cost-amplifying kick-off route: mirrors the existing POST /pulls/:id/review limit (AC-17). */
export const MULTI_AGENT_RATE_LIMIT = { max: 10, timeWindow: '1 minute' } as const;

/** How many groups GET /multi-agent/recent returns — the "recent runs" landing list. */
export const RECENT_GROUPS_LIMIT = 10;
