# server — insights

> Durable, non-obvious learnings for `@devdigest/api` (Fastify, Drizzle, DI/container, and the
> repo-intel indexer that lives inside this package). Maintained via the `engineering-insights`
> skill: append-only, deduplicated, substance only. Read before working; empty sections are
> expected, not a bug. Cross-package facts go in the repo-root `insights.md`.

## What Works

## What Doesn't Work

## Codebase Patterns

- `agent_runs`-write signatures are declared **twice** and BOTH must change together:
  the impl `repository/run.repo.ts::completeAgentRun` AND the class facade
  `repository.ts::completeAgentRun` (the latter re-types the `values` object literally).
  Add a field to only one and `tsc` fails at the call site in `run-executor.ts`, not at
  the facade — so the error points away from the file you forgot.

## Tool & Library Notes

- Adding a field to `RunStats` (and anything else inside the `run_traces.trace` **jsonb
  document**) must use `.nullish()`, NOT `.nullable()`: historical trace docs predate the
  field, and `GET /runs/:id/trace` returns the stored JSON as-is (no response Zod schema,
  no migration of old docs), so a required/`nullable` field would type-mismatch on old
  rows. `RunSummary`/table-backed columns can stay `.nullable()` since the repo maps every
  column explicitly. (Per-run cost feature, 2026-06-20.)

## Recurring Errors & Fixes

## Session Notes

## Open Questions
