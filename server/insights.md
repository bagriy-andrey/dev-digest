# server — insights

> Durable, non-obvious learnings for `@devdigest/api` (Fastify, Drizzle, DI/container, and the
> repo-intel indexer that lives inside this package). Maintained via the `engineering-insights`
> skill: append-only, deduplicated, substance only. Read before working; empty sections are
> expected, not a bug. Cross-package facts go in the repo-root `insights.md`.

## What Works

## What Doesn't Work

- `tsx watch` does NOT hot-reload changes to `vendor/shared/**` files. `DEFAULTS` in `feature-models.ts` is computed at module-load time from `FEATURE_MODELS`; editing `vendor/shared/contracts/platform.ts` has no effect until the server process is killed and restarted. This burned ~30 min chasing a stale `openai` default.

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

## Tool & Library Notes

- `GET /agents` and `GET /agents/:id` do NOT populate linked skills — `skills` is always absent. Use the separate `GET /agents/:id/skills` endpoint to inspect skill links. The seed's `agentSkills` inserts with `onConflictDoNothing` are order-dependent: if the referenced agent doesn't exist when the seed first runs, re-run the seed after adding the agent entry.
- Drizzle aggregate pattern for list-with-count: `db.select({ agent: t.agents, skill_count: count(t.agentSkills.skillId) }).from(t.agents).leftJoin(t.agentSkills, eq(...)).groupBy(t.agents.id)` then `.map(({ agent, skill_count }) => ({ ...agent, skill_count }))`. The `toAgentDto` helper accepts `AgentRow & { skill_count?: number }` — existing single-row callers (`getById`, `update`) keep passing plain `AgentRow` and get `skill_count: undefined` with no type error.
- Adding a field to `RunStats` (and anything else inside the `run_traces.trace` **jsonb document**) must use `.nullish()`, NOT `.nullable()`: historical trace docs predate the field, and `GET /runs/:id/trace` returns the stored JSON as-is (no response Zod schema, no migration of old docs), so a required/`nullable` field would type-mismatch on old rows. `RunSummary`/table-backed columns can stay `.nullable()` since the repo maps every column explicitly. (Per-run cost feature, 2026-06-20.)

## Recurring Errors & Fixes

## Session Notes

- 2026-06-22: added `findings_by_severity` to `PrMeta` + `GET /repos/:id/pulls` route; removed the prior "intentionally not surfaced" comment that blocked this.
- 2026-06-22: added `PrFindingSummary` type + `findings` field to `PrMeta` for PR-list tooltip; single extended JOIN query builds both the severity-counts map and the capped findings list in one DB round-trip.
- 2026-06-24: Skills feature spec written (server/specs/skills.md). Audited existing scaffold: DB tables, shared contracts, agentsRepo skill-linking methods, and reviewer-core prompt assembler are all in place. Gap: `modules/skills/` missing, `agent_skills.enabled` column missing, run-executor passes `skills: null` unconditionally. Spec covers 10 implementation steps in order.
- 2026-06-25: Full server-side skills implementation: migration 0011 (agent_skills.enabled), modules/skills/ (repository/service/routes), @fastify/multipart + adm-zip for file import, run-executor wire-in, AgentSkillLink contract updated in both vendored copies, seed extended with 4 skills + 2 new agents. Client: lib/hooks/skills.ts written; UI components in fork agent.
- 2026-06-26: Conventions Extractor built end-to-end: migration 0012 (evidence_line), modules/conventions/ (repository/service/routes), feature model default openrouter/deepseek-v4-flash, extraction returns 13 validated candidates from ai-stock-app. API Contract Reviewer agent seeded with 5 skills. Client conventions page + hooks + components complete; experiment (skills-off vs skills-on) deferred.
- 2026-07-03: Added `skill_count` to `GET /agents` via LEFT JOIN + `count()` + `groupBy` in `AgentsRepository.list()`; `toAgentDto` made optional on `skill_count` so non-list callers need no change. Both vendor `Agent` contracts updated (server + client).

## Open Questions

- API Contract Reviewer experiment (skills-off vs skills-on) not yet run — needs a breaking-change PR in a cloned repo + two review runs to compare.
