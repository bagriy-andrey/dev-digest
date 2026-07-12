# mcp-server (@devdigest/mcp-server) — module map

Two entry points, one package: a stdio [MCP](https://modelcontextprotocol.io)
server exposing DevDigest review capabilities as 5 tools, AND a `devdigest`
CLI bin (`devdigest review --mode working`) for a local pre-push review loop.
Both are pure HTTP clients of the already-running `@devdigest/api` (`:3001`)
— no DB access, no new-endpoint ownership, no auth. Standalone package (own
`package.json` + `package-lock.json`, npm not pnpm), NOT a workspace member.
Depth: `mcp-server/README.md`.

## Local commands
- `npm run dev` — `tsx src/index.ts` (MCP server), no build step.
- `npm run cli` — `tsx src/cli.ts` (CLI bin), no build step.
- `npm run build` — `tsc` → `dist/` (emits both `dist/index.js` and
  `dist/cli.js`). `npm start` runs the built MCP server; the built CLI is run
  via the `bin` entry (`devdigest`, after `npm link`/`npm install -g .`).
- `npm run typecheck` — `tsc --noEmit`.
- `npm test` — `vitest run`; all unit tests run hermetically (mock `ApiClient`
  / `GitPort`, no live server, no real git, no LLM key needed).

## Conventions (non-default)
- MCP server layout, imports point inward only: `schemas.ts` / `errors.ts` /
  `api/types.ts` (pure) ← `resolvers.ts` / `poll.ts` / `mappers.ts` (logic,
  depend on the `ApiClient` port) ← `tools/*.ts` (one file per tool) ←
  `api/http-client.ts` (the fetch adapter) ← `server.ts` (composition root,
  builds the client + registers all 5 tools) ← `index.ts` (entry point, wires
  `StdioServerTransport`).
- CLI layout, same inward-imports rule, a separate composition root:
  `git.ts` (a `GitPort` + pure `parseRemoteUrl`, `api/types.ts`'s
  `AgentReviewResult`) ← `cli/format.ts` (pure terminal rendering + the
  exit-code gate) ← `cli/review.ts` (orchestration: depends on `ApiClient` +
  `GitPort` ports, deps injected — same inject-for-testability pattern as
  `poll.ts`'s `now`/`sleep`) ← `cli.ts` (entry/bin, composition root for the
  CLI — builds `ApiClient`/`GitPort` and calls `runReview`).
- `ApiClient` (`src/api/client.ts`) is an injected **port**; `HttpApiClient`
  (`src/api/http-client.ts`) is the only adapter, shared by both entry
  points. Tool handlers, resolvers, and `runReview` are all unit-tested
  against a hand-written mock, never a live server.
- `src/api/types.ts` types are hand-copied field SUBSETS of the shared
  contracts in `server/src/vendor/shared/contracts/*` — this package cannot
  import `@devdigest/shared` (vendored into `server`/`client` only, not
  published). If a consumed contract's shape changes server-side, update the
  subset here by hand; nothing enforces the two staying in sync.
- All 5 MCP tools take flat args (`repo: "owner/name"`, `pr: number`,
  `agent?: name-or-uuid`); `resolvers.ts` turns names into server-issued UUIDs
  before any UUID is interpolated into a URL path (injection-sink guard, see
  `src/api/http-client.ts`'s `assertUuid`). The CLI resolves its own repo UUID
  client-side (`listRepos()` matched against the parsed `origin` remote) and
  the same `assertUuid` guard applies before it hits `reviewDiff`'s URL path.
- Errors from the 5 MCP tools are "forward-leading": `ForwardError`
  (`src/errors.ts`) names the next tool to call on a miss/timeout, rather than
  just failing. The CLI instead uses a small numeric exit-code contract (see
  Gotchas) — it's a terminal program, not an LLM-facing tool result.
- `git.ts`'s shell adapter uses `execFile('git', args, ...)` — an **array** of
  args, never a shell string — so there is no shell-interpolation /
  command-injection sink (`security` skill guard, mirrors `assertUuid` above).
- **stdout rule differs by entry point** — the load-bearing distinction
  between the two bins:
  - `index.ts` (MCP/stdio transport) is **stderr-only**. stdout is the
    JSON-RPC wire; a stray `console.log` corrupts every message after it.
  - `cli.ts` (the `devdigest` bin) **writes results to stdout** (results) and
    diagnostics/errors to stderr — a normal terminal program. Only `cli.ts`
    (and what it calls via the injected `out`/`err` writers in
    `cli/review.ts`) may write to stdout in this package.

## Gotchas
- Needs `./scripts/dev.sh` up (the API on `:3001`) to do anything real for
  either entry point; `npm test` does not need it.
- `run_agent_on_pr` and `devdigest review` both trigger REAL, paid LLM runs —
  the former fire-and-forget + polls `GET /pulls/:id/runs`; the latter calls
  the SYNCHRONOUS `POST /repos/:id/review-diff` (findings in the response, no
  polling, nothing persisted server-side).
- NEVER write to stdout from `index.ts` or anything it transitively calls —
  see the stdout rule above.
- `get_blast_radius` is a pure stub (no HTTP call, no `ApiClient` argument) —
  there is no blast-radius endpoint on `@devdigest/api` yet.
- CLI exit-code contract (so it can back a `.git/hooks/pre-push` script —
  wiring the hook itself is out of scope): `0` = clean, `1` = blocking
  findings (any agent's server-computed `blockers > 0`), `2` = usage error /
  repo-resolution failure / infra error (network, git, unknown flag/mode).
- Only `--mode working` is implemented (bare `git diff`, working tree vs
  index). `--mode staged` and `--mode branch` are recognized argv values but
  `git.ts`'s `MODE_DIFF_ARGS.branch === null` — the git port throws a clear
  not-yet-implemented error for `branch` rather than doing the wrong thing.

## Pointers — read on demand
- `../specs/mcp-server.md` — the design plan the MCP server was built from.
- `../specs/pre-push-cli.md` — the design plan the `devdigest` CLI was built
  from (spans this package + the `server/` `review-diff` endpoint it calls).
- `../server/AGENTS.md` — the API surface this package consumes (`/repos`,
  `/pulls`, `/agents`, `/reviews`, `/conventions`, `/repos/:id/review-diff`).
- `mcp-server/README.md` — install/build/run + MCP client registration + CLI
  install/dev-loop.
- `mcp-server/insights.md` — READ before working here; APPEND via
  `/engineering-insights`.
