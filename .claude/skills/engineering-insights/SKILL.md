---
name: engineering-insights
description: "Captures durable, non-obvious engineering learnings into the touched module's insights.md (server/, client/, reviewer-core/, e2e/, or root for cross-cutting). Use at the START of work to read the relevant module's insights as high-confidence guidance, AS-YOU-GO when something non-obvious surfaces, and at the END of a substantive session to append what was learned. Append-only, deduplicated, substance over volume."
---

# Engineering Insights — capture-learnings loop

A persistent memory that compounds across sessions: each module keeps an `insights.md` of
hard-won, non-obvious facts. Read it before working and append to it after learning something —
so a future session starts already knowing what this one discovered. (Manual RAG, no infra.)

- Entry format, vague-vs-useful pairs, and the capture/don't-capture list → see [examples.md](examples.md).
- Sources, rationale, and the L06 Stop-hook mechanism → see [references.md](references.md).

## Where to write — pick the file by the module the learning belongs to
- `server/insights.md` — Fastify API, Drizzle, DI/container, **repo-intel** (it lives inside server).
- `client/insights.md` — Next.js studio UI, TanStack Query, vendored UI.
- `reviewer-core/insights.md` — the pure review engine (diff → prompt → LLM → grounded findings).
- `e2e/insights.md` — agent-browser flows.
- `insights.md` (repo root) — cross-cutting / monorepo facts: vendored `shared` sync,
  `scripts/dev.sh`, the 4-separate-lockfiles setup, the `.it.test.ts` test split.

If one task touches several modules, write each insight to the file it actually belongs to.

## The three mandatory rules

1. **Read before you start.** The moment a request names or implies a module, READ that
   module's `insights.md` BEFORE doing any work. Treat it as high-confidence guidance unless the
   user says otherwise. (`CLAUDE.md` enforces this too.)
2. **Read before you write — dedup.** Before appending, READ the target file. If the insight (or
   an equivalent) is already there, do NOT write it again. If an existing entry is now wrong,
   don't delete it — append a dated correction beneath it.
3. **Write only the substantive.** Record only genuinely non-obvious learnings not already
   captured. If the session produced nothing that qualifies, write NOTHING — silence is correct.
   Signal-to-noise beats volume; a bloated file gets ignored. (Capture list → examples.md.)
4. **Never overwrite.** Write to a `<module>/insights.md` **only**, and only by **appending** a
   bullet (use Edit to add lines — NEVER use Write to replace the file, and never delete or rewrite
   existing entries; correct a stale one with a dated note beneath it). NEVER modify, overwrite, or
   delete any **other** file — especially another skill's `SKILL.md`, `.claude/settings.json`, the
   hook scripts, or source code. This skill only ever grows `insights.md` files.

## When to capture
- **As-you-go** — the instant something non-obvious bites (a gotcha, a failed approach, a
  decision-with-reason), capture it while it's fresh.
- **Wrap-up** — at the end of a substantive session (roughly >30 min, with a real problem,
  decision, or discovery), run the workflow below. Skip trivial sessions entirely.

Manual trigger: `/engineering-insights` runs the wrap-up pass over the current session — a
fallback that also works when hooks are disabled. **Automatic mode is normally on** (see below).

## Wrap-up workflow (the `/engineering-insights` pass)
1. **Gate.** If the session was trivial (no problem/decision/discovery), stop — write nothing.
2. **Collect candidates** from the session, ranked by signal strength:
   user corrections > failed approaches > repeated patterns/errors > decisions-with-reasoning.
3. **Read the target `insights.md` and dedup** — drop any candidate already covered or in conflict.
4. **Keep only the substantive few** (soft cap ~5 per session). Apply the capture/don't-capture
   test (examples.md).
5. **Append** each survivor under its correct section, in the entry format, to the right module's
   file. Datestamp Session Notes entries.
6. Never record an insight about this skill itself.

## Automatic mode (hooks — no `/engineering-insights` needed)
Two project hooks in `.claude/settings.json` make the loop run on its own:
- **Read** — a `UserPromptSubmit` command hook (`.claude/hooks/inject-insights.sh`) detects the
  module(s) named in your prompt and injects that module's `insights.md` into context *before*
  work — but only when the file has real entries (empty templates stay silent).
- **Write** — a `Stop` prompt hook runs this skill's wrap-up when a session ends: read the touched
  module's `insights.md`, append a substantive, non-duplicate learning (or nothing). Unskippable.

Hooks load at session start — restart Claude Code after changing them. Disable by removing the
hooks from `.claude/settings.json`; the manual `/engineering-insights` trigger still works.

## The 7 fixed sections (every insights.md has these — empty is fine)
- **What Works** — approaches/patterns/solutions proven effective here.
- **What Doesn't Work** — failed approaches, dead ends, antipatterns. (Most-skipped, most valuable.)
- **Codebase Patterns** — project-specific conventions, architecture decisions, naming.
- **Tool & Library Notes** — quirks/gotchas of dependencies as discovered.
- **Recurring Errors & Fixes** — errors seen more than once and how they were resolved.
- **Session Notes** — datestamped one-line summaries of what a session accomplished.
- **Open Questions** — things left unresolved or needing more investigation.

## Maintenance
Append-only within a session. Periodically prune entries that have gone stale (a fixed bug, a
removed pattern) — stale guidance is worse than none. Treat `insights.md` as a draft under human
spot-check, and commit it to git so the knowledge is shared and versioned.
