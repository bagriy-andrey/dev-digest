# server — insights

> Durable, non-obvious learnings for `@devdigest/api` (Fastify, Drizzle, DI/container, and the
> repo-intel indexer that lives inside this package). Maintained via the `engineering-insights`
> skill: append-only, deduplicated, substance only. Read before working; empty sections are
> expected, not a bug. Cross-package facts go in the repo-root `insights.md`.

## What Works

## What Doesn't Work

- `tsx watch` does NOT hot-reload changes to `vendor/shared/**` files. `DEFAULTS` in `feature-models.ts` is computed at module-load time from `FEATURE_MODELS`; editing `vendor/shared/contracts/platform.ts` has no effect until the server process is killed and restarted. This burned ~30 min chasing a stale `openai` default.
- `pnpm db:generate` (`drizzle-kit generate`) was BROKEN (fixed 2026-07-04) by a corrupted merge in commit `0148df2` ("renumber migrations 0010/0011 → 0011/0012"), which took two independently-branched migrations (Skills, Conventions) and renamed them onto the same numeric slots WITHOUT re-chaining or re-deriving their snapshots. Two separate, compounding symptoms from the same root cause:
  1. `0011_snapshot.json` and `0012_snapshot.json` had the SAME `id` AND the same `prevId` — drizzle-kit's snapshot-chain validator saw two children of one parent ("collision") and aborted before diffing any new schema at all.
  2. Once (1) is fixed, a SECOND, more insidious symptom surfaces: both snapshots also silently DROPPED the `agent_runs.cost_usd` column from their `tables` section — even though migration `0010_cheerful_shard.sql` (from the "add costs to pr review" commit, `b058639`) genuinely adds it and it IS applied in the real DB. The merge kept `0010`'s snapshot correct but based `0011`/`0012` on a pre-`b058639` schema state, so their column lists silently regressed. Symptom: any subsequent `db:generate` — even for a totally unrelated new table — sees `cost_usd` as "missing" (relative to the stale 0012 snapshot) and generates a spurious `ALTER TABLE agent_runs ADD COLUMN cost_usd` that fails at `db:migrate` time with `column "cost_usd" ... already exists`, because the column was never actually missing — only its snapshot bookkeeping was. **Do not "fix" this by generating a catch-up migration for the phantom column** (that was tried and reverted this session) — the correct fix is repairing the snapshot's `columns` map to match reality, not adding a redundant migration.
  Both snapshot `id`/`prevId` AND the `cost_usd` column entry were manually repaired directly in `0011_snapshot.json`/`0012_snapshot.json`. The runtime migrator (`drizzle-orm/postgres-js/migrator` via `src/db/migrate.ts`) was never affected by any of this — it only reads `_journal.json` and applies `.sql` files in order by hash, so `pnpm db:migrate` worked fine throughout. ⇒ If `db:generate` ever again proposes a change to a column you believe already exists and is already migrated, suspect stale/corrupted snapshot metadata before assuming real drift — check `git log -- <migration>.sql` and grep the column into every snapshot in the chain, don't just trust the newest one.

## Codebase Patterns

- `agent_skills` join table now has `enabled boolean NOT NULL DEFAULT true` (migration 0011). Skill injection in `run-executor.ts` must filter BOTH `link.enabled && link.skill.enabled` — one flag is global (skill disabled for everyone), the other is per-agent. Filtering only one silently passes disabled skills through.
- Skills prompt injection lives entirely in `run-executor.ts → runOneAgent`: load `agentsRepo.linkedSkills(agent.id)`, filter where `link.enabled && link.skill.enabled`, map to bodies, pass as `skills:` to `reviewPullRequest`. The `reviewer-core` prompt assembler already accepts `parts.skills?: string[]` and produces `## Skills / rules` — no changes to `reviewer-core` needed.
- `modules/skills/` follows the standard `repository → service → routes` pattern. The service is NOT in the DI container (`platform/container.ts`) — it is instantiated directly in routes via `new SkillsService(app.container.db)`. This matches the lesson scope and avoids container churn.
- `AgentSkillLink` shared contract (in both `server/src/vendor/shared` and `client/src/vendor/shared`) must be kept in sync manually — it's vendored, not npm. Added `enabled: z.boolean().default(true)` to both copies in this session.
- `@fastify/multipart` must be registered globally in `app.ts` before any route calls `req.file()`. It was absent from the server's plugin list; adding it after SSEPlugin works fine.
- Skills stats query (`getStats`) does not join through a `skill_id` on `findings` — there is no such column. Instead it uses the agent-level proxy: find all agents with this skill linked (`agent_skills`), then aggregate `findings` via `reviews → agent_runs` filtered by those agent IDs. This means "findings for this skill" really means "findings from agents that use this skill", which is the correct semantic.
- Skill body versioning: write the OLD body to `skill_versions` BEFORE updating `skills.body`. The snapshot captures the pre-change state so version history is a full replayable log.
- `findings` has no direct `pr_id` column — to query findings by PR you must JOIN through `reviews`: `findings.review_id → reviews.id → reviews.pr_id`. Any new findings-by-PR query needs `.innerJoin(t.reviews, eq(t.findings.reviewId, t.reviews.id)).where(inArray(t.reviews.prId, prIds))`.
- `agent_runs`-write signatures are declared **twice** and BOTH must change together: the impl `repository/run.repo.ts::completeAgentRun` AND the class facade `repository.ts::completeAgentRun`. Add a field to only one and `tsc` fails at the call site in `run-executor.ts`, not at the facade — so the error points away from the file you forgot.

- **Per-feature model selection (`FEATURE_MODELS` / `resolveFeatureModel`) is scoped per-WORKSPACE only — there is no per-repo override anywhere.** `settings` table columns are `(workspace_id, user_id, key, value)` with a unique index on those three (`server/src/db/schema/core.ts`); `repos` has no config/settings JSON column at all (`server/src/db/schema/repos.ts`). `resolveFeatureModel(container, workspaceId, id)` (`modules/settings/feature-models.ts`) only ever reads the workspace-scoped row. ⇒ Any feature wanting "global default + per-repo override" model selection needs NEW schema (e.g. a `repo_id` column on `settings`, or a config column on `repos`) — it cannot be built by reusing the existing mechanism as-is.
- The `'review_intent'` `FeatureModelId` is registered in `FEATURE_MODELS` (`vendor/shared/contracts/platform.ts`, default `openai/gpt-4.1`) and `pr_intent`/`pr_brief` DB tables + `Intent` zod contract + `ReviewRepository.getIntent`/`upsertIntent` all exist, but **nothing in `server/src` actually calls `resolveFeatureModel(..., 'review_intent')` or `getIntent`/`upsertIntent`** — grep confirms zero call sites outside the repository/contract layer itself. This is pure unbuilt scaffolding (see root `insights.md` for the full cross-cutting picture), not a working feature to build on top of.

## Tool & Library Notes

- `GET /agents` and `GET /agents/:id` do NOT populate linked skills — `skills` is always absent. Use the separate `GET /agents/:id/skills` endpoint to inspect skill links. The seed's `agentSkills` inserts with `onConflictDoNothing` are order-dependent: if the referenced agent doesn't exist when the seed first runs, re-run the seed after adding the agent entry.
- Drizzle aggregate pattern for list-with-count: `db.select({ agent: t.agents, skill_count: count(t.agentSkills.skillId) }).from(t.agents).leftJoin(t.agentSkills, eq(...)).groupBy(t.agents.id)` then `.map(({ agent, skill_count }) => ({ ...agent, skill_count }))`. The `toAgentDto` helper accepts `AgentRow & { skill_count?: number }` — existing single-row callers (`getById`, `update`) keep passing plain `AgentRow` and get `skill_count: undefined` with no type error.
- Adding a field to `RunStats` (and anything else inside the `run_traces.trace` **jsonb document**) must use `.nullish()`, NOT `.nullable()`: historical trace docs predate the field, and `GET /runs/:id/trace` returns the stored JSON as-is (no response Zod schema, no migration of old docs), so a required/`nullable` field would type-mismatch on old rows. `RunSummary`/table-backed columns can stay `.nullable()` since the repo maps every column explicitly. (Per-run cost feature, 2026-06-20.)

## Recurring Errors & Fixes

- Multi-agent step execution: an isolated git worktree does NOT see a prior "done" plan step
  if that step's output only exists as UNCOMMITTED changes in the main checkout (`git status`
  dirty there) — `git worktree` only shares committed refs, never another checkout's working
  tree/index. Symptom: a file/table/migration the plan says "already exists" (e.g.
  `repo_feature_models` / `schema/repo-settings.ts`) is simply absent from your worktree, and
  `pnpm typecheck` fails to resolve it. Fix: `diff <main>/path <worktree>/path` on the specific
  dependency files to confirm the delta is exactly the prior step's declared output (nothing
  extra), then copy just those files into the worktree before starting your own step — don't
  redesign schema you were told is already done.
- The `...(cond ? { field } : {})` conditional-spread pattern used to pass optional prompt
  fields to `reviewPullRequest(...)` in `run-executor.ts` bypasses TypeScript's excess-property
  check: `pnpm typecheck` stays green even if `reviewer-core`'s `ReviewInput` doesn't yet declare
  that field (e.g. wiring in `intent` before `reviewer-core`'s `intent?:` field lands). This means
  a producer-side wire-in can silently compile against a stale consumer type — the field is
  passed at runtime but does nothing until the consumer type/logic actually reads it. Don't treat
  a clean typecheck here as proof the consumer package already supports the new field.
- The `tokens ≈ chars / 4` heuristic is NOT exported anywhere reusable — it's inlined
  (`adapters/tokenizer/index.ts::approxTokens`, operating on a `string`) with no exported divisor
  constant. A pure domain module that needs the same heuristic on precomputed char COUNTS (not a
  string to re-encode) can't cleanly import it: `approxTokens` takes text, and importing from
  `adapters/*` into a pure `modules/<x>/helpers.ts` also crosses the onion layering (adapters are
  outer-layer I/O-adjacent code). Resolution used in `modules/intent/helpers.ts`: re-declare the
  tiny `Math.ceil(chars / 4)` formula locally with a comment citing the mirrored location, rather
  than importing the adapter or reconstructing a dummy string of that length just to call it.
- `container` has no `.logger` — the established pattern for a service method that wants
  structured logging on an ad-hoc call (not a full `agent_run`) is an OPTIONAL `logger?: Logger`
  parameter (minimal pino-compatible shape: `info/warn/error(obj, msg?)`), passed by the route as
  `req.log` (mirrors `ReviewService.runReview(workspaceId, prId, targets, logger)` /
  `reviews/routes.ts`'s `req.log` argument). Don't invent a container-level logger getter.
- `pnpm db:generate` diffs against the ENTIRE current schema state, not just the file(s) you just
  edited. If it proposes a change unrelated to what you touched, don't assume it's real
  never-migrated drift — it may be stale/corrupted snapshot metadata instead (see the
  `0011`/`0012`/`cost_usd` entry above; that's exactly what happened here, and generating a
  catch-up migration for it was the WRONG fix, later reverted). Genuinely isolating your own
  change is still good practice regardless: temporarily move your new schema file(s) out, run
  `db:generate` once to see what (if anything) it proposes on its own, restore your file(s), then
  `db:generate` again — a real pre-existing drift will show up isolated in the first run; a
  snapshot-metadata bug will make the first run propose a change to a column that a `git log`
  on the actual migration files shows was already added and applied.
- `cd server && pnpm typecheck` fails with `Cannot find module 'openai'/'zod'` inside `../reviewer-core/src/**` if `reviewer-core/node_modules` was never installed in that checkout/worktree. Server's `tsconfig.json` path-aliases `@devdigest/reviewer-core` straight to `../reviewer-core/src`, pulling reviewer-core's source (and its own `openai`/`zod` deps) into the server's `tsc` program; server's own `node_modules` does NOT satisfy that resolution since reviewer-core is a sibling package with its own lockfile, not a parent. Fix: `cd reviewer-core && npm install` once per checkout/worktree — reviewer-core is the one package of the four that uses `npm`/`package-lock.json`, NOT `pnpm` (confirmed by its committed `package-lock.json`; running `pnpm install` there instead fabricates a stray `pnpm-lock.yaml`/`pnpm-workspace.yaml` that should be deleted, not committed).

## Session Notes

- 2026-06-22: added `findings_by_severity` to `PrMeta` + `GET /repos/:id/pulls` route; removed the prior "intentionally not surfaced" comment that blocked this.
- 2026-06-22: added `PrFindingSummary` type + `findings` field to `PrMeta` for PR-list tooltip; single extended JOIN query builds both the severity-counts map and the capped findings list in one DB round-trip.
- 2026-06-24: Skills feature spec written (server/specs/skills.md). Audited existing scaffold: DB tables, shared contracts, agentsRepo skill-linking methods, and reviewer-core prompt assembler are all in place. Gap: `modules/skills/` missing, `agent_skills.enabled` column missing, run-executor passes `skills: null` unconditionally. Spec covers 10 implementation steps in order.
- 2026-06-25: Full server-side skills implementation: migration 0011 (agent_skills.enabled), modules/skills/ (repository/service/routes), @fastify/multipart + adm-zip for file import, run-executor wire-in, AgentSkillLink contract updated in both vendored copies, seed extended with 4 skills + 2 new agents. Client: lib/hooks/skills.ts written; UI components in fork agent.
- 2026-06-26: Conventions Extractor built end-to-end: migration 0012 (evidence_line), modules/conventions/ (repository/service/routes), feature model default openrouter/deepseek-v4-flash, extraction returns 13 validated candidates from ai-stock-app. API Contract Reviewer agent seeded with 5 skills. Client conventions page + hooks + components complete; experiment (skills-off vs skills-on) deferred.
- 2026-07-03: Added `skill_count` to `GET /agents` via LEFT JOIN + `count()` + `groupBy` in `AgentsRepository.list()`; `toAgentDto` made optional on `skill_count` so non-list callers need no change. Both vendor `Agent` contracts updated (server + client).
- 2026-07-04: Intent Layer feature spec written (server/specs/intent-layer.md), cross-package (server + reviewer-core + client). Audited existing scaffold first: `pr_intent`/`pr_brief` tables, `Intent` shared contract, `getIntent`/`upsertIntent` (zero call sites), `FEATURE_MODELS.review_intent` entry (wrong default: openai/gpt-4.1), `resolveFeatureModel`, and end-to-end linked-issue resolution in the GitHub adapter were ALL already in place — none of it wired to anything. Plan's real net-new work: flash default, a new `repo_feature_models` table + resolver for per-repo model override, `modules/intent/` classifier module, a new `intent` optional prompt slot in `reviewer-core`, and the client Intent card + Settings override UI. 11 execution steps with disjoint file ownership; no code written yet.

## Open Questions

- API Contract Reviewer experiment (skills-off vs skills-on) not yet run — needs a breaking-change PR in a cloned repo + two review runs to compare.
