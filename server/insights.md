# server — insights

> Durable, non-obvious learnings for `@devdigest/api` (Fastify, Drizzle, DI/container, and the
> repo-intel indexer that lives inside this package). Maintained via the `engineering-insights`
> skill: append-only, deduplicated, substance only. Read before working; empty sections are
> expected, not a bug. Cross-package facts go in the repo-root `insights.md`.

## What Works

## What Doesn't Work

## Codebase Patterns

- `agent_skills` join table now has `enabled boolean NOT NULL DEFAULT true` (migration 0010). Skill injection in `run-executor.ts` must filter BOTH `link.enabled && link.skill.enabled` — one flag is global (skill disabled for everyone), the other is per-agent. Filtering only one silently passes disabled skills through.
- Skills prompt injection lives entirely in `run-executor.ts → runOneAgent`: load `agentsRepo.linkedSkills(agent.id)`, filter where `link.enabled && link.skill.enabled`, map to bodies, pass as `skills:` to `reviewPullRequest`. The `reviewer-core` prompt assembler already accepts `parts.skills?: string[]` and produces `## Skills / rules` — no changes to `reviewer-core` needed.
- `modules/skills/` follows the standard `repository → service → routes` pattern. The service is NOT in the DI container (`platform/container.ts`) — it is instantiated directly in routes via `new SkillsService(app.container.db)`. This matches the lesson scope and avoids container churn.
- `AgentSkillLink` shared contract (in both `server/src/vendor/shared` and `client/src/vendor/shared`) must be kept in sync manually — it's vendored, not npm. Added `enabled: z.boolean().default(true)` to both copies in this session.
- `@fastify/multipart` must be registered globally in `app.ts` before any route calls `req.file()`. It was absent from the server's plugin list; adding it after SSEPlugin works fine.
- Skills stats query (`getStats`) does not join through a `skill_id` on `findings` — there is no such column. Instead it uses the agent-level proxy: find all agents with this skill linked (`agent_skills`), then aggregate `findings` via `reviews → agent_runs` filtered by those agent IDs. This means "findings for this skill" really means "findings from agents that use this skill", which is the correct semantic.
- Skill body versioning: write the OLD body to `skill_versions` BEFORE updating `skills.body`. The snapshot captures the pre-change state so version history is a full replayable log.

## Tool & Library Notes

## Recurring Errors & Fixes

## Session Notes

- 2026-06-24: Skills feature spec written (server/specs/skills.md). Audited existing scaffold: DB tables, shared contracts, agentsRepo skill-linking methods, and reviewer-core prompt assembler are all in place. Gap: `modules/skills/` missing, `agent_skills.enabled` column missing, run-executor passes `skills: null` unconditionally. Spec covers 10 implementation steps in order.
- 2026-06-25: Full server-side skills implementation: migration 0010 (agent_skills.enabled), modules/skills/ (repository/service/routes), @fastify/multipart + adm-zip for file import, run-executor wire-in, AgentSkillLink contract updated in both vendored copies, seed extended with 4 skills + 2 new agents. Client: lib/hooks/skills.ts written; UI components in fork agent.

## Open Questions
