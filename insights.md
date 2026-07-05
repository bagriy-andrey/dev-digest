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

  **2026-07-04 correction: this entire entry is STALE.** Commit `b058639` ("add costs to pr
  review") already did exactly this plumbing: `agent_runs.cost_usd` was re-added by migration
  `0010_cheerful_shard.sql`, `run-executor.ts` now destructures and persists `costUsd`, and it's
  exposed in the vendored `PrMeta`/`RunSummary`/`RunStats` contracts. However, the merge in
  commit `0148df2` (renumbering migrations onto `0011`/`0012`) silently dropped `cost_usd` from
  those two snapshots' `agent_runs` column list (though the actual migration/DB/code all still
  have it correctly) — this caused a separate, confusing `db:generate` bug fixed in this same
  session; see `server/insights.md`'s "What Doesn't Work" entry on the `0011`/`0012` snapshot
  corruption for the full story. Don't re-derive "cost surfacing is unbuilt" from this entry —
  it's done; only the snapshot metadata briefly lied about one column's history.

- `.claude/skills/README.md`'s skill catalog table is **stale**: at least
  `postgresql-table-design` and `pr-self-review` have real, populated skill directories under
  `.claude/skills/` but are not listed in that README's table. ⇒ Don't rely on the README
  table alone to enumerate available skills — glob `.claude/skills/*/SKILL.md` directly when
  it matters whether a skill exists.

- The **"Intent Layer" feature already has partial scaffolding** before any dedicated
  implementation work began: an `Intent` zod schema `{intent, in_scope, out_of_scope}` exists in
  the vendored shared contracts (`.../vendor/shared/contracts/brief.ts`) as part of a composed
  `PrBrief` (`intent`, `blast`, `risks`, `history`); `FEATURE_MODELS` in
  `.../vendor/shared/contracts/platform.ts` already registers a selectable `'review_intent'`
  feature (default `provider: 'openai'`, `model: 'gpt-4.1'` — NOT a flash/cheap model yet);
  `Settings.feature_models` already supports a per-feature model override keyed by
  `FeatureModelId`; `server/src/modules/reviews/repository/pull.repo.ts` already exports
  `getIntent`/`upsertIntent`; `PrDetail` already carries a `linked_issue: IssueMeta` field. ⇒
  Before building an Intent Layer, audit what of this existing scaffolding is wired up
  end-to-end vs. dead/unused code — the "cheap flash-class model" requirement means the
  `review_intent` default in `FEATURE_MODELS` needs to change, not just be read.

- **Vendored `@devdigest/shared` has TWO physical copies, not three — and the client UI reads a
  THIRD, non-vendored registry.** `reviewer-core/tsconfig.json` aliases `@devdigest/shared` to
  **the server's** `server/src/vendor/shared` (not its own copy). So editing a contract under
  `server/src/vendor/shared/**` (e.g. `contracts/platform.ts`, `contracts/trace.ts`) covers BOTH
  server AND reviewer-core; only `client/src/vendor/shared/**` needs hand-mirroring. Separately,
  the **client UI renders `FEATURE_MODELS` from `client/src/lib/feature-models.ts`**, NOT from the
  vendored copy (importing a runtime VALUE from vendored shared breaks Next's webpack resolution —
  see the comment in that file). ⇒ A user-visible feature-model default change must edit
  `client/src/lib/feature-models.ts`; the vendored client copy is types-only for the UI. (These
  two client files have already drifted for the `conventions` entry — don't assume they match.)

## Tool & Library Notes

- **`agent-browser` (Vercel's CDP browser CLI) is usable for manual/one-off UI verification** even
  though it isn't preinstalled: `npx -y agent-browser@latest install` downloads a headless Chrome
  (~170MB, one-time), then `npx -y agent-browser@latest --session <name> <cmd>` drives it —
  `open <url>`, `snapshot -i` (interactive-elements-only accessibility tree with `@eN` refs),
  `click @eN`, `get url`, `tab list` (confirms no unexpected new tab opened), `screenshot --full`,
  `close`. Note: its CLI shape is one-shot-command-per-invocation (`agent-browser <cmd>`), NOT the
  stdin-piped multi-line REPL the `run` skill's `examples/playwright.md` shows for `chromium-cli` —
  don't pipe a heredoc script to it, chain separate invocations against the same `--session` name
  instead (the daemon keeps the page alive between calls). `e2e/` already has a real npm dependency
  on this same tool (`@devdigest/e2e`'s `run.ts`) for its deterministic flow specs — this is the
  same binary, just driven ad hoc instead of via `specs/*.flow.json`.

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
