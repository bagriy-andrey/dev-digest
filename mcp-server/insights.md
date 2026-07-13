# mcp-server — insights

> Durable, non-obvious learnings for `@devdigest/mcp-server` (the local stdio
> MCP server, HTTP client of `@devdigest/api`). Maintained via the
> `engineering-insights` skill: append-only, deduplicated, substance only.
> Read before working; empty sections are expected, not a bug. Cross-package
> facts go in the repo-root `insights.md`.

## What Works

## What Doesn't Work

## Codebase Patterns

- **The planned Pre-push CLI (`devdigest review --mode working`) is a SECOND bin entry in this
  package, not a 6th MCP tool** — it talks to a new server endpoint synchronously (no polling,
  no persistence) and prints to stdout directly, unlike the stdio MCP server which may only
  write to stderr. It needs its own `git` port (raw `git diff` + remote-URL parsing) injected the
  same way `poll.ts` injects `now`/`sleep`, so the CLI's orchestration logic stays unit-testable
  without shelling out for real. Repo auto-detection (git remote → owner/name → DevDigest repo)
  does not need a new server lookup route: the existing `listRepos()` call already returns
  `full_name` per repo, so matching happens client-side in this package (see root `insights.md`'s
  entry on `RepoRepository.findByFullName` — that method exists server-side but is unexposed and
  unnecessary here for the same reason — see `server/insights.md`).

## Tool & Library Notes

- `@modelcontextprotocol/sdk` v1.29.0 confirmed API shapes used by `server.ts`/
  `index.ts`: `new McpServer(serverInfo: Implementation, options?: ServerOptions)`
  (from `@modelcontextprotocol/sdk/server/mcp.js`) and
  `new StdioServerTransport()` (from `.../server/stdio.js`, zero-arg — it reads
  `process.stdin`/writes `process.stdout` by default, no need to pass streams).
- `outputSchema` passed to `server.registerTool(...)` must resolve to a JSON-Schema **object**
  at the top level — a bare `z.array(...)` (or any raw-shape equivalent) is rejected, since
  `structuredContent` is validated as an object. Any tool whose natural result is a list
  (`list_agents`, `get_conventions`) must wrap it under a key (`{agents: [...]}`,
  `{conventions: [...]}`) rather than returning the array directly as the top-level shape.
- `execFile('git', args, { cwd, maxBuffer }, callback)` (array args, no shell string) is the
  injection-safe way to shell out to git; do NOT use `util.promisify(execFile)` if you plan to
  mock `node:child_process` in tests — the built-in `execFile` has a `util.promisify.custom`
  symbol that resolves to `{stdout, stderr}`, which a plain `vi.fn()` mock won't carry, breaking
  promisify's resolution shape. Wrapping `execFile`'s callback in a hand-rolled `new Promise(...)`
  sidesteps this and makes the callback trivially mockable in tests.
- To protocol-correctly smoke-test the built `dist/index.js` over real stdio
  (rather than hand-rolling JSON-RPC framing), spawn it via the SDK's own
  client-side `Client` + `StdioClientTransport` from
  `@modelcontextprotocol/sdk/client/index.js` / `.../client/stdio.js` in a
  throwaway script — `client.listTools()` / `client.callTool(...)` do the full
  handshake for you. Must run the script from inside `mcp-server/` (or with
  `cwd` set there) so plain Node ESM resolves `@modelcontextprotocol/sdk` from
  its `node_modules` — running it from an unrelated directory (e.g. a scratch
  tmp folder) throws `ERR_MODULE_NOT_FOUND`.

- To live-smoke-test `devdigest review` end to end (repo match → `POST
  /repos/:id/review-diff` → real LLM run → formatted stdout) without touching
  any tracked file in the actual imported repo's checkout, use a disposable
  scratch git repo elsewhere: `git init`, one commit, an uncommitted edit (so
  `git diff` is non-empty), and `git remote add origin
  <url-matching-an-already-imported-repo's-full_name>`. The server never
  validates the POSTed diff text against the target repo's real contents —
  `reviewDiff`'s repo lookup is purely `full_name` string matching
  (`listRepos()`), so an unrelated scratch diff round-trips through a real
  agent run against a genuinely imported repo. Also: the default
  `DEVDIGEST_HTTP_TIMEOUT_MS` (30s) is too short for a multi-agent
  `reviewDiff` round trip (5 enabled agents run sequentially, real LLM calls
  took well over a minute) — bump it (e.g. `DEVDIGEST_HTTP_TIMEOUT_MS=180000`)
  for a live CLI smoke test, otherwise the `AbortController` fires and the CLI
  exits 2 with "This operation was aborted" even though the server would have
  finished the run.

- To interactively test/inspect the stdio server via a web UI (no scratch script needed), run
  `npx @modelcontextprotocol/inspector npx tsx src/index.ts` from inside `mcp-server/` — it spawns
  the server as a child process over stdio, proxies it through a local HTTP/WS bridge (default
  `localhost:6277`), and serves a browser UI (default `localhost:6274`, auth token printed to
  stdout) for listing tools and calling them by hand. Same cwd requirement as the throwaway
  SDK-client smoke script above (must resolve `@modelcontextprotocol/sdk` from this package's
  `node_modules`) — running the outer `npx` from the repo root silently breaks the inner
  `src/index.ts` relative path with no obvious error until you try to connect. Needs the API on
  `:3001` up first, same as any other real run of this entry point.
- Each Inspector process run mints a fresh `MCP_PROXY_AUTH_TOKEN`; restarting it (killing the
  background process and re-launching) does NOT preserve the token, so an already-open browser
  tab from a prior run silently fails to authenticate against the new proxy — it reads as a
  generic connection/tool-call error in the UI, not an auth error. There is no symptom pointing at
  "stale tab" specifically; the fix is always reloading with the freshly printed URL, not
  debugging the tool call itself.

## Recurring Errors & Fixes

- **A client-aborted `devdigest review` call does NOT stop the server from continuing to process
  it.** After a first CLI invocation hit the default 30s `DEVDIGEST_HTTP_TIMEOUT_MS` and the
  `AbortController` fired client-side ("This operation was aborted"), the server's `POST
  /repos/:id/review-diff` request never logged "request completed" — not then, and not minutes
  later — Fastify/the agent pipeline has no cancellation wired to the client socket closing.
  Re-invoking the CLI (even with a longer timeout) while that first request was presumably still
  running server-side produced a plain "fetch failed" (a different error than an abort) instead of
  a real result, and neither request ever completed in the log. Killing and restarting the API
  process (`pnpm dev` in `server/`) cleared the stuck state; a single clean invocation afterward
  completed normally. ⇒ If a `devdigest review` call times out or errors client-side, don't
  immediately re-run it against the same repo — either wait it out or restart the API process
  first, since the previous run may still be occupying the pipeline.

## Session Notes

## Open Questions
