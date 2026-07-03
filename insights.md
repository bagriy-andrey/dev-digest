# root — insights (cross-cutting / monorepo)

> Durable, non-obvious learnings that span packages (vendored `shared` sync, `scripts/dev.sh`,
> the 4-separate-lockfiles setup, the `.it.test.ts` split). Module-specific facts go in that
> module's `insights.md`. Maintained via the `engineering-insights` skill: append-only,
> deduplicated, substance only. Read before working; empty sections are expected, not a bug.

## What Works

## What Doesn't Work

## Codebase Patterns

- The **Planner/Implementer subagent pair** (`.claude/agents/planner.md`,
  `.claude/agents/implementer.md`) relies on **disjoint file ownership per
  plan step**, not `isolation: worktree` alone, to make parallel Implementer
  runs safe. `isolation: worktree` only isolates each instance's *working
  copy* — it does nothing to stop two steps from being planned to touch the
  same file, which would just surface as a merge conflict later. The actual
  safety guarantee has to come from the Planner declaring non-overlapping
  file lists per step in the plan's Execution Order section. ⇒ Any future
  parallel-subagent orchestration in this repo needs that same constraint
  enforced at the planning stage, not assumed from git-worktree isolation.

- Per-run **cost is already computed by `reviewer-core`** end-to-end: `ReviewOutcome.costUsd`
  (number | null) comes from OpenRouter's `usage.cost` extension, with an injected
  `estimateCost(model, in, out)` price-table fallback. It is then **silently dropped at the
  server boundary** — `server/.../reviews/run-executor.ts` destructures only
  `{ tokensIn, tokensOut, grounding }` from the outcome and never reads `costUsd`. The
  `agent_runs.cost_usd` column also once existed and was removed by migration
  `0009_complex_runaways.sql`. ⇒ Surfacing cost in the UI is **plumbing-only** (re-add the
  column, stop dropping the field, expose it in the vendored `shared` contracts —
  `PrMeta`/`RunSummary`/`RunStats`), NOT an engine change and zero extra model calls.
  (PR-list `cost` lives on `agent_runs`, NOT `reviews`, so it needs its own latest-run
  subquery — it can't piggyback the existing latest-`score`-from-reviews query.)

## Tool & Library Notes

## Recurring Errors & Fixes

## Session Notes

## Open Questions
