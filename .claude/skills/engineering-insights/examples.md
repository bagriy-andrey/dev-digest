# Engineering Insights — examples & the capture bar

Concrete patterns for writing entries that earn their place in an `insights.md`.
The governing test: **if it would be obvious to anyone reading the code, don't write it.**

## Vague vs useful

Each entry must be actionable *cold* — an agent reading it with no other context knows exactly
what to do or avoid.

| ❌ Vague (noise — don't write) | ✅ Useful (actionable cold) |
|---|---|
| "Promises can be tricky." | "`Promise.all()` on the ingest pipeline times out after ~30 items — use `Promise.allSettled()` in batches of 10 (`server/src/modules/repo-intel/indexer.ts`)." |
| "Be careful with async." | "Checkout state must go through Zustand (`cartStore.ts`) — 3 components share the cart; local React state silently desyncs them." |
| "Tests are flaky." | "e2e flows 02/04/05 assume the seeded repo is the ONLY one (they follow the home redirect); a dev DB with other repos lands them wrong — use `./scripts/e2e.sh`." |
| "Drizzle has quirks." | "A DB-backed test MUST use the `*.it.test.ts` suffix or the unit/integration split silently runs it in the hermetic pool with no Postgres." |

Lead with the fact, then the *why / evidence* as `file:line`. Keep it one declarative line.

## A good entry per section (DevDigest-flavored)

- **What Works** — "`auto` review strategy only map-reduces when the diff is >400 lines AND
  multi-file; otherwise single-pass is faster and cheaper (`reviewer-core`)."
- **What Doesn't Work** — "Adding denylist keyword scanning for prompt-injection — the engine's
  defense is ONE trusted rule (`INJECTION_GUARD`); keyword parsing weakens grounding, don't add it."
- **Codebase Patterns** — "A server feature = `modules/<name>/{routes,service,repository}.ts` + ONE
  entry in `modules/index.ts`. Registration is static, not filesystem autoload."
- **Tool & Library Notes** — "`fastify-type-provider-zod`: the route's Zod schema validates the
  request AND serializes the response — don't hand-roll `Schema.parse` in the handler."
- **Recurring Errors & Fixes** — "`pgvector` extension missing on a fresh DB → run `pnpm db:migrate`
  (migration 0000 enables it); migrations are NOT applied on boot."
- **Session Notes** — "- 2026-06-20: traced why empty repo-intel enrichment isn't an error — the
  prompt falls back to diff-only by design."
- **Open Questions** — "Does the boot-time reaper of orphaned `running` agent_runs misbehave with
  >1 API replica? Assumes a single instance per DB."

## Capture / don't-capture

**Capture** (durable, non-obvious, reusable):
- A gotcha that cost real time to diagnose.
- An env/tooling quirk + the *exact* flag or command that fixes it.
- An error seen more than once, with its fix.
- A decision made with a tradeoff — and the reason.
- An undocumented dependency, service, or env var.
- A cross-module invariant the code doesn't make obvious.

**Don't capture** (noise — leave it out):
- One-time edits or task-specific decisions that won't recur.
- Anything already obvious from the code or stated in `CLAUDE.md` / `README.md`.
- Facts about code that's still actively changing (not stable knowledge yet).
- Restatements of documentation.
- Meta-notes about this skill itself.
