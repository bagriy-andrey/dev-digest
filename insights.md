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

- `.claude/skills/README.md`'s skill catalog table is **stale**: at least
  `postgresql-table-design` and `pr-self-review` have real, populated skill directories under
  `.claude/skills/` but are not listed in that README's table. ⇒ Don't rely on the README
  table alone to enumerate available skills — glob `.claude/skills/*/SKILL.md` directly when
  it matters whether a skill exists.

## Tool & Library Notes

- The `fastify-best-practices` skill's `rules/testing.md` examples use Node's built-in
  `node:test` + `app.inject()`, but this repo's actual server test runner is **vitest**
  (`server/package.json`: `"test": "vitest run"`, vitest `^2.1.8`). Don't copy that skill's
  test-code samples verbatim for `server/` — they'd produce tests that don't fit this repo's
  actual test infra. For server test conventions, use `TESTING.md` + existing examples
  (`server/test/adapters.test.ts` for unit, `server/test/integration.it.test.ts` for the
  `*.it.test.ts`-suffixed real-Postgres pattern) instead of that skill's code blocks.

## Recurring Errors & Fixes

- An `isolation: worktree` subagent's branch is forked from whatever commit was HEAD at
  worktree-creation time — it does **not** auto-follow later commits on the base branch, and it
  never sees the base repo's **untracked/uncommitted** files (e.g. a `specs/*.md` plan file that
  exists only as untracked in the main working tree, or sibling agent `.md` files added after the
  worktree's fork point). ⇒ Before concluding a referenced file is missing inside a worktree, check
  whether it exists in the main repo checkout at its absolute path outside `.claude/worktrees/<id>/`
  — read-only references (spec files, precedent agent/skill files) can be read from the main repo
  path even though the step's own deliverable must still be written inside the worktree. Also:
  `implementer`-style agents cannot merge/push their own worktree branch back — the caller must
  manually copy the new file(s) out and integrate them into the main checkout.

## Session Notes

## Open Questions
