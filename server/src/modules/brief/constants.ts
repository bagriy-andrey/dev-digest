/**
 * Constants for the PR Why + Risk Brief module (SPEC-02). Kept apart from
 * `helpers.ts`/`service.ts` so the input-size budget (the ≤ 8K-token SOFT
 * target — see the plan's §5 Risks) has a single, easy-to-find set of knobs.
 */

/** `resolveFeatureModel` id — workspace-level only (no per-repo override, Non-goal). */
export const BRIEF_FEATURE_ID = 'risk_brief' as const;

/**
 * Cap on how many of the repo's discovered Context-Folder specs are pulled
 * into the brief's input. Specs are the only UNBOUNDED contributor (a repo
 * could have arbitrarily many docs) — this cap protects the token budget.
 */
export const MAX_BRIEF_SPEC_DOCS = 4;

/**
 * Per-corpus char cap applied ACROSS the selected specs combined (not per
 * doc) — mirrors `intent/helpers.ts`'s `capBody` truncate-with-notice shape,
 * just applied over a concatenation instead of a single field.
 */
export const MAX_BRIEF_SPEC_CHARS = 12_000;

/**
 * Cap on the linked issue's body text, mirroring `intent/helpers.ts`'s
 * `MAX_INTENT_BODY_CHARS` truncate-with-notice shape (smaller here: the
 * brief only needs a WHY/risk signal from the issue, not to reproduce it).
 */
export const MAX_BRIEF_ISSUE_CHARS = 8_000;
