# DevDigest — project map (a map, NOT documentation)

Local-first AI pull-request review. Add a PR → run an agent review on it.
This file loads every session: keep it ≤100 lines. Depth lives in the linked
docs — don't duplicate them here.

## Session protocol — insights loop (run the `engineering-insights` skill)
- START: the moment a request names or implies a module, READ that module's `insights.md`
  (`server/`, `client/`, `reviewer-core/`, `e2e/`, or root for cross-cutting) BEFORE any work;
  treat it as high-confidence guidance unless told otherwise.
- END: run `/engineering-insights`. Append ONLY a substantive, non-obvious learning that isn't
  already there (read first, dedup). If nothing qualifies, write nothing — don't skip the check.

## Stack
Node ≥22 · pnpm ≥10 · TypeScript (path aliases, no cross-package publish).
Fastify 5 · Drizzle ORM · Postgres + pgvector · Next.js 15 · React 19 · Zod.

## Commands
- Boot all: `./scripts/dev.sh` — Postgres (Docker) + API :3001 + web :3000, migrated + seeded.
- DB: `cd server && pnpm db:migrate && pnpm db:seed`  ← migrations are NOT applied on boot.
- E2E: `./scripts/e2e.sh` — isolated stack on alt ports; never touches your dev DB.
- Test/typecheck: per package `pnpm test` / `pnpm typecheck`.

## Where things live (4 packages — NOT a workspace; each has its own lockfile)
- `server/`        — `@devdigest/api`: Fastify + Drizzle. repo-intel indexer lives inside it.
- `client/`        — `@devdigest/web`: Next.js studio UI.
- `reviewer-core/` — `@devdigest/reviewer-core`: pure engine diff→prompt→LLM→grounded findings (no I/O).
- `e2e/`           — `@devdigest/e2e`: agent-browser flows (deterministic, no LLM).

## Cross-cutting gotchas (the agent can't guess these from code)
- `@devdigest/shared` (Zod contracts) is VENDORED into each package via tsconfig
  path alias, not installed from npm. Edit the copy under `server/src/vendor/shared`;
  `client` has its own vendored copy — keep them in sync by hand.
- The DB schema already contains EVERY table; lessons fill the empty ones later.
  A table with no rows is expected, not a bug.
- `reviewer-core` never emits JS — its `build` is a typecheck; consumers import TS source.
- Secrets (LLM keys, GITHUB_TOKEN) live in `~/.devdigest/secrets.json` (mode 0600)
  or env — never in git or the DB. Canonical: `GITHUB_TOKEN` (`GITHUB_PAT` = fallback).
- Server tests split by filename: `*.it.test.ts` = real Postgres (testcontainers);
  everything else is hermetic. A DB-backed test MUST use the `.it.test.ts` suffix.

## Do NOT touch
- `docker compose down -v` — deletes the `devdigest_pgdata` volume and every imported
  repo / review. Use `./scripts/e2e.sh` to reset an isolated stack instead.
- `server/src/db/migrations/0000*` — enables the pgvector extension.

## CLAUDE.md rules (for whoever edits these files)
- It's a map, not a manual: stack, commands, top-level layout, non-default
  conventions, gotchas, do-not-touch. Detailed architecture → link, don't inline.
- ≤100 lines per file. Test each line: "remove it — would the agent start erring?"
  No → cut it. Per-module conventions go in `<module>/CLAUDE.md`, NOT here.
- Pointers are `read when …` instructions, not footnotes. No `@import` yet (L01).

## Pointers — read these on demand
- `README.md` — full architecture diagram + the course-lesson feature map.
- `server/CLAUDE.md` · `client/CLAUDE.md` · `reviewer-core/CLAUDE.md` · `e2e/CLAUDE.md`
  — auto-load when you touch that package; read first when working inside it.
- `TESTING.md` — read when changing the test split, CI, or adding a DB-backed test.
- `docs/agent-prompts/` — read when editing the built-in agents' system prompts.
