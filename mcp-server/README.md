# @devdigest/mcp-server

Local, stdio [MCP](https://modelcontextprotocol.io) server exposing DevDigest
PR-review capabilities as 5 tools to an MCP client (e.g. Claude Code). It is a
**pure HTTP client** of the already-running `@devdigest/api` — no DB access,
no new server endpoints, no auth. Requires `./scripts/dev.sh` (the DevDigest
API on `:3001`) to be running to do anything useful.

## Install & build

```bash
cd mcp-server && npm install && npm run build
```

This produces `dist/index.js` (compiled from `src/index.ts`).

## Register with an MCP client

With the dev stack up (`./scripts/dev.sh` from the repo root):

```bash
claude mcp add devdigest \
  -e DEVDIGEST_API_URL=http://localhost:3001 \
  -- node /ABSOLUTE/PATH/dev-digest/mcp-server/dist/index.js
```

### Fast dev loop (no build step)

Swap the command for `tsx` running the TS source directly — useful while
iterating on tool logic:

```bash
claude mcp add devdigest \
  -e DEVDIGEST_API_URL=http://localhost:3001 \
  -- npx tsx /ABSOLUTE/PATH/dev-digest/mcp-server/src/index.ts
```

## Tools

| Tool | What it does |
|---|---|
| `list_agents` | Lists all configured review agents (`{id, name, description, provider, model, enabled}`). |
| `run_agent_on_pr` | Triggers a real review run for `(repo, pr, agent)`, polls until it finishes, and returns `{verdict, findings}`. Non-read-only — spends a real LLM call. |
| `get_findings` | Returns the latest persisted review's `{verdict, findings}` for a `(repo, pr)` without triggering a new run. |
| `get_conventions` | Returns extracted repo conventions for `repo`; an empty list means the repo isn't indexed yet, not an error. |
| `get_blast_radius` | Stub — always returns a fixed `not_implemented` payload. No HTTP call; this course lesson hasn't shipped the endpoint yet. |

All tools take flat args: `repo` is `"owner/name"`, `pr` is the PR number,
`agent` is an agent name or UUID. Unknown repo/PR/agent, or a run that times
out, produce a "forward" error whose message names the next tool to try.

## Environment variables

All optional; defaults target the local dev stack.

| Var | Default | Meaning |
|---|---|---|
| `DEVDIGEST_API_URL` | `http://localhost:3001` | Base URL of the running `@devdigest/api`. |
| `DEVDIGEST_RUN_TIMEOUT_MS` | `480000` (8 min) | Max time `run_agent_on_pr` polls before giving up and forwarding to `get_findings`. |
| `DEVDIGEST_POLL_INTERVAL_MS` | `2000` | Delay between successive run-status polls. |
| `DEVDIGEST_HTTP_TIMEOUT_MS` | `30000` | Per-HTTP-call timeout (`AbortController`). |

## Local commands

- `npm run dev` — run `src/index.ts` directly via `tsx` (no build).
- `npm run cli` — run `src/cli.ts` directly via `tsx` (no build) — see the
  CLI section below.
- `npm run build` — `tsc` to `dist/` (emits both `dist/index.js` and
  `dist/cli.js`).
- `npm start` — run the built `dist/index.js`.
- `npm run typecheck` — `tsc --noEmit`.
- `npm test` — `vitest run` (all unit tests; no live server needed).

See `mcp-server/AGENTS.md` for the module map and `../specs/mcp-server.md` for
the full design plan.

## CLI: `devdigest review` (local pre-push review)

A second `bin` in this package — not an MCP tool. Runs the same agents and
review pipeline as the PR page, synchronously, on your **local uncommitted
diff**, before you push. Nothing is persisted server-side (no `agent_runs`,
`reviews`, or `findings` rows are created). Requires `./scripts/dev.sh` up
(the API on `:3001`) and the target repo already imported into DevDigest (the
CLI auto-detects the repo from your `origin` remote — both SSH and HTTPS
forms are supported — and matches it against `GET /repos`' `full_name`; it
does not create or configure repos for you).

```bash
devdigest review --mode working
```

### Install (global command)

```bash
cd mcp-server && npm install && npm run build && npm link
# or: npm install -g .
```

This puts a global `devdigest` command on your `PATH`, runnable from any
locally-imported repo's working copy.

### Dev loop (no build step)

```bash
npx tsx src/cli.ts review --mode working
```

Run this from inside the repo you want to review (its `origin` remote is
used for repo auto-detection), not from inside `mcp-server/` itself, unless
`mcp-server/` is the repo you're reviewing.

### Modes

Only `--mode working` (default; bare `git diff` — working tree vs. the
index, i.e. unstaged changes) is implemented in v1. `--mode staged` (`git
diff --cached`) and `--mode branch` (committed-but-unpushed) are recognized
argv values reserved for a future addition — passing `--mode branch` today
fails clearly with a "not yet implemented" error rather than doing the wrong
thing.

### Environment variables

Same `DEVDIGEST_API_URL` the MCP server reads (default
`http://localhost:3001`) — point it at a non-default API host if your stack
isn't running on the default port.

### Exit codes

| Code | Meaning |
|---|---|
| `0` | Clean — no blocking findings (or no local changes to review at all). |
| `1` | At least one agent's server-computed gate (`blockers > 0`, per that agent's `ciFailOn`) tripped. |
| `2` | Usage error (bad/unknown flag or mode), repo-resolution failure (no `origin` remote, or the repo isn't imported into DevDigest), or an infra error (network, git). |

This exit-code contract is intentionally small enough to back a
`.git/hooks/pre-push` script — e.g. `exec devdigest review --mode working`
as the hook body would block a push on `blockers > 0`. Wiring the actual git
hook (installing/symlinking it) is left to you; this package only guarantees
the exit codes are meaningful for that use.
