# e2e (@devdigest/e2e) — module map

Deterministic browser end-to-end flows for the web app, driven by Vercel
**agent-browser** (Rust + CDP). No Playwright, no LLM, no API key. Depth: `e2e/README.md`.

## Local commands
- Hermetic (recommended): `./scripts/e2e.sh` — isolated freshly-seeded stack on alt ports
  (PG :5433, API :3101, web :3100), runs flows, tears down. Safe alongside your dev stack.
- One-time: `npm i -g agent-browser && agent-browser install`.
- Against your own stack: `cd e2e && npm install && npm test` — ONLY safe if your dev DB has
  just the seeded repo (see README precondition).

## Conventions (non-default)
- A flow is a JSON list of agent-browser commands in `specs/NN-name.flow.json`, run in order
  by `run.ts` against one shared browser session. agent-browser is a CLI, not a test framework.
- `{BASE}` is substituted with `E2E_BASE_URL`. A non-zero exit fails the step — so
  `wait --text` / `wait --url` ARE the assertions. Optional `assert.stdoutIncludes` adds a check.
- Locators are deterministic only (`--url`, `--text`, `find role|text|label`). NEVER use the AI
  `chat` command — runs must stay stable and key-free.
- Flows target read-only seeded data (demo repo `acme/payments-api`, PR #482, seeded agents),
  so nothing triggers a model call.

## Gotchas / Do NOT
- ⚠️ NEVER `docker compose down -v` to "reset" your dev DB — it deletes `devdigest_pgdata`
  and every imported repo/review. Use the hermetic runner for a clean DB.
- Flows 02/04/05 assume the seeded repo is the ONLY one (they follow the home redirect to the
  first repo). Your dev DB usually has others → they land wrong and fail. Prefer `./scripts/e2e.sh`.
- Note: here `specs/` holds the flow definitions (the tests), not feature specifications.

## Pointers — read on demand
- `e2e/README.md` — how a flow works, env knobs, coverage table (source of truth).
- `specs/*.flow.json` — read when adding/adjusting a flow; copy the nearest one as a template.
- `e2e/docs/` — read when … (deep notes; currently empty).
- `e2e/insights.md` — read when a flow is flaky/failing; APPEND a line after a non-obvious fix.
