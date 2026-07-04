# reviewer-core — insights

> Durable, non-obvious learnings for `@devdigest/reviewer-core` (the pure review engine:
> diff → prompt → LLM → grounded findings; no I/O). Maintained via the `engineering-insights`
> skill: append-only, deduplicated, substance only. Read before working; empty sections are
> expected, not a bug. Cross-package facts go in the repo-root `insights.md`.

## What Works

## What Doesn't Work

## Codebase Patterns

- `assemblePrompt`'s `INJECTION_GUARD` text (`src/prompt.ts`) already explicitly lists
  "derived intent/scope" alongside diff/PR title/description/comments/README as untrusted
  content the model must never treat as instructions — i.e. an Intent-Layer-style section was
  anticipated by this guard before any such section existed. ⇒ When adding a new
  `PromptParts.intent` slot (same pattern as the existing optional `skills`/`memory`/`specs`/
  `callers`/`repoMap` slots — conditionally pushed into `userSections`, omitted when empty, no
  required-field changes), wrap the actual intent JSON/text in `wrapUntrusted(...)` like `specs`/
  `callers`/`prDescription` do; only a short *trusted* framing sentence (e.g. the "don't comment
  outside intent scope" rule) should sit outside the untrusted wrapper, since that's a policy
  instruction, not derived-from-PR content. Also extend `AssembledPrompt`/`PromptAssembly` (same
  file) with the new field, mirroring `skills: skillsBlock ?? null`, so it's captured in the run
  trace like every other optional slot.

- Adding a new optional slot's field to the `assembly: PromptAssembly = {...}` object literal in
  `assemblePrompt` (`src/prompt.ts`) fails `tsc` with "Object literal may only specify known
  properties" until the corresponding field exists on the zod-inferred `PromptAssembly` type in
  `@devdigest/shared` (`server/src/vendor/shared/contracts/trace.ts`, aliased in for
  reviewer-core too). This is a genuine compile-time cross-package dependency even though the
  two changes may be planned as separate "no dependencies" parallel steps — the
  `PromptParts`/`ReviewInput` field addition here compiles standalone, but the `assembly` object
  literal does not typecheck until the shared contract's matching field lands. Land/merge the
  shared-contract field first (or accept a transiently red `tsc` until both land together).

## Tool & Library Notes

## Recurring Errors & Fixes

## Session Notes

## Open Questions
