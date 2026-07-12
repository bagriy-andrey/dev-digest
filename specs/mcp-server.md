# Spec: DevDigest MCP Server (local, stdio, 5 tools)

**Status:** planning
**Scope:** new standalone package `mcp-server/` (sibling to `server/`, `client/`,
`reviewer-core/`, `e2e/`). NOT a workspace member — own `package.json` + own
lockfile. Talks to the already-running `@devdigest/api` (:3001) over HTTP only.
No changes to any existing package.

This plan is scoped to one brand-new package but lives at repo root (`specs/`)
because it is not owned by any existing package — mirrors the
`server/specs/*.md` / `e2e/specs/*.md` convention, one level up.

---

## 0. What already exists (do not touch)

Everything the MCP server consumes already ships in `@devdigest/api`. The MCP
server is a pure HTTP client of these — it adds NO server code, NO DB access,
NO new endpoints.

| Capability | Existing API surface | Response shape (source of truth) |
|---|---|---|
| List repos (workspace-scoped) | `GET /repos` | `Repo[]` — `{id, owner, name, full_name, …}` (`server/src/vendor/shared/contracts/platform.ts:148`) |
| List PRs for a repo | `GET /repos/:id/pulls` | `PrMeta[]` — `{id, number, title, …}` (`platform.ts:181`) |
| List agents | `GET /agents` | `Agent[]` — `{id, name, description, provider, model, enabled, …}` (`knowledge.ts:177`) |
| Trigger a review run | `POST /pulls/:id/review` body `{agentId}` | `{pr_id, runs: [{run_id, agent_id, agent_name}], reviews: []}` (`reviews/routes.ts:27`, `reviews/service.ts:103`) |
| Run history for a PR (poll target) | `GET /pulls/:id/runs` | `RunSummary[]` — `{run_id, status ("running"\|"done"\|"failed"\|"cancelled"), findings_count, score, error, …}` (`trace.ts:98`) |
| Persisted reviews + findings for a PR | `GET /pulls/:id/reviews` | `ReviewDto[]` — `{id, pr_id, run_id, agent_id, verdict, summary, score, findings: Finding[]}` (`reviews/helpers.ts:18`) |
| Repo conventions | `GET /repos/:id/conventions` | `ConventionCandidate[]` — `{id, rule, evidence_path, evidence_line?, evidence_snippet, confidence, accepted}` (`knowledge.ts:144`) |

Contract facts that shape the tool outputs (already verified against source):

- **`Finding`** (`findings.ts:47`): `{id, severity (CRITICAL|WARNING|SUGGESTION),
  category (bug|security|perf|test|style), title, file, start_line, end_line,
  rationale, suggestion?, confidence (0..1), kind?, …}`. The concise tool output
  keeps only `{severity, category, title, file, start_line, end_line, confidence,
  rationale}` — this exactly mirrors the slim **`PrFindingSummary`**
  (`platform.ts:165`) the API itself already uses for its PR-list tooltip. Drop
  `suggestion`, `evidence`, `trifecta_components`, action timestamps.
- **`Verdict`** (`findings.ts:25`): `'request_changes' | 'approve' | 'comment'`.
  On `ReviewDto` it is `verdict: string | null`.
- **Auth**: none. `server/src/modules/_shared/context.ts` resolves a default
  workspace/user via `LocalNoAuthProvider` regardless of headers. The MCP server
  sends NO auth header/token.
- **`POST /pulls/:id/review` is fire-and-forget**: `ReviewService.runReview`
  returns `{runs, reviews: []}` IMMEDIATELY (reviews always empty here) and runs
  the LLM in the background (`reviews/service.ts:133`). ⇒ `run_agent_on_pr` MUST
  poll `GET /pulls/:id/runs` and then read `GET /pulls/:id/reviews`; it can never
  get findings from the POST response.
- **`POST /pulls/:id/review` is rate-limited** to 10/min (`reviews/routes.ts:29`).
  One `run_agent_on_pr` call = one POST, so this is a non-issue for a single tool
  invocation; note it so a caller looping the tool understands a possible 429.
- **No blast-radius endpoint exists.** `modules/index.ts:26` lists `blast` only as
  a *future* course-lesson module. `get_blast_radius` is a pure stub — no HTTP
  call at all.
- **repo-intel degrades silently** (`server/AGENTS.md`): an unindexed repo yields
  an empty conventions list, not an error. `get_conventions` treats `[]` as a
  valid "nothing extracted yet" result, not a failure.

---

## 1. Module breakdown (single package `mcp-server/`)

The package is small (< 15 source files, effectively one "feature"): use the
**flat, layered** layout from `ui-architecture`'s small-scale guidance, adapted
to a non-React CLI. Ports-and-adapters still applies (`onion-architecture`): the
HTTP client is an injected **port** (`ApiClient` interface) so tool handlers and
resolvers are unit-testable with a mock — no live server needed.

Dependency direction (inner → outer, imports point inward only):

```
schemas.ts / errors.ts / types.ts   (pure: zod schemas, error class, response types)
        ▲
resolvers.ts / poll.ts              (pure-ish logic; depend on the ApiClient PORT interface)
        ▲
tools/*.ts                          (one file per tool; depend on ApiClient + schemas + resolvers)
        ▲
api/http-client.ts                  (ADAPTER: concrete fetch impl of ApiClient)
server.ts                           (composition root: builds ApiClient, registers tools)
index.ts                            (entry: wires StdioServerTransport, starts)
```

### New files to create

| Path | Purpose | Key exports |
|---|---|---|
| `mcp-server/package.json` | Package manifest; scripts; deps. Name `@devdigest/mcp-server`, `"type": "module"`, `"private": true`. | — |
| `mcp-server/tsconfig.json` | TS config: `module`/`moduleResolution` `NodeNext`, `target` `ES2023`, `strict`, `outDir dist`, `rootDir src`. Mirror `server/tsconfig.json` compiler strictness. | — |
| `mcp-server/.gitignore` | ignore `dist/`, `node_modules/`. | — |
| `mcp-server/README.md` | How to install, build, run, and register with an MCP client (the `claude mcp add` command). Full usage depth. | — |
| `mcp-server/AGENTS.md` | Module map (≤100 lines), matching `e2e/AGENTS.md` shape: what it is, local commands, conventions, gotchas, pointers. See §"AGENTS.md content" below. | — |
| `mcp-server/insights.md` | Empty insights file with the standard header (mirror `server/insights.md` top comment). Sections: What Works / What Doesn't Work / Codebase Patterns / Tool & Library Notes. | — |
| `mcp-server/src/config.ts` | Read env once. `DEVDIGEST_API_URL` (default `http://localhost:3001`), `DEVDIGEST_RUN_TIMEOUT_MS` (default `480000` = 8 min), `DEVDIGEST_POLL_INTERVAL_MS` (default `2000`), `DEVDIGEST_HTTP_TIMEOUT_MS` (default `30000`). | `loadConfig(): Config`, `type Config` |
| `mcp-server/src/errors.ts` | `ForwardError` — an error whose message NAMES the next tool/step to try ("errors lead forward"). Carries `{ message, nextStep }`; `toToolResult()` renders an MCP error result. | `class ForwardError`, `type NextStep` |
| `mcp-server/src/api/types.ts` | Minimal TS response types mirroring the SUBSET of shared contracts the client reads (`RepoDto`, `PrMetaDto`, `AgentDto`, `RunSummaryDto`, `ReviewDto`, `ReviewFinding`, `ConventionDto`, `RunTriggerResponse`). Hand-copied field subsets — the package does NOT import `@devdigest/shared` (it is vendored into server/client only, not published). Keep to the fields actually consumed. | the above `type`s |
| `mcp-server/src/api/client.ts` | The `ApiClient` **port** (interface) + method contracts: `listRepos()`, `listPulls(repoId)`, `listAgents()`, `triggerReview(prId, agentId)`, `listRuns(prId)`, `listReviews(prId)`, `listConventions(repoId)`. | `interface ApiClient` |
| `mcp-server/src/api/http-client.ts` | `HttpApiClient implements ApiClient` — the fetch adapter. Uses global `fetch` (Node ≥22), `AbortController` for per-call timeout, JSON parse, maps non-2xx to `ForwardError` where meaningful (see §Security). Base URL from config. UUIDs are validated before being interpolated into paths. | `class HttpApiClient`, `createApiClient(config): ApiClient` |
| `mcp-server/src/schemas.ts` | Zod raw-shape input schemas + output schemas for all 5 tools. Shared flat arg primitives: `repoArg` (`z.string().regex(owner/name)`), `prArg` (`z.number().int().positive()`), `agentArg` (`z.string().min(1)`). Concise output schema `ReviewResultSchema = { verdict, findings: [{severity, category, title, file, start_line, end_line, confidence, rationale}] }`. Blast stub schema. | one exported raw-shape per tool + `ReviewResult` type |
| `mcp-server/src/resolvers.ts` | Name→UUID resolution against the `ApiClient`. `resolveRepo(client, "owner/name") → repoId`, `resolvePr(client, repoId, number) → prId`, `resolveAgent(client, "name-or-uuid") → {agentId, agentName}`. Each throws a `ForwardError` on miss that names the recovery tool (see §Errors). Accepts a UUID for `agent` directly (matches `id` OR `name`, case-insensitive). | `resolveRepo`, `resolvePr`, `resolveAgent` |
| `mcp-server/src/poll.ts` | `pollRunUntilDone(client, prId, runId, {intervalMs, timeoutMs}) → RunSummaryDto`. Loops `listRuns(prId)`, finds our `run_id`, resolves when `status ∈ {done, failed, cancelled}`, rejects with `ForwardError` on overall timeout (message: "run still in progress after Ns; retry get_findings shortly"). Pure logic; time via injected `now`/`sleep` for tests. | `pollRunUntilDone` |
| `mcp-server/src/mappers.ts` | Pure mappers: `toReviewResult(review: ReviewDto): ReviewResult` (slim finding projection + verdict), `pickReviewForRun(reviews, runId)` (match by `run_id`, fallback to newest `kind:'review'`), `toAgentSummary`, `toConventionSummary`. Domain helpers — no I/O. | the above fns |
| `mcp-server/src/tools/list-agents.ts` | Tool `list_agents`: `client.listAgents()` → `[{id, name, description, provider, model, enabled}]`. Read-only/idempotent annotations. | `registerListAgents(server, client)` |
| `mcp-server/src/tools/run-agent-on-pr.ts` | Tool `run_agent_on_pr(repo, pr, agent)`: resolve → `triggerReview` → `pollRunUntilDone` → `listReviews` → `pickReviewForRun` → `toReviewResult`. NON-read-only annotation (triggers paid LLM). On poll timeout / failed run, returns a `ForwardError` result naming `get_findings` as the follow-up. | `registerRunAgentOnPr(server, client, config)` |
| `mcp-server/src/tools/get-findings.ts` | Tool `get_findings(repo, pr, agent?)`: resolve repo+pr (+ agent if given) → `listReviews` → pick newest matching review → `toReviewResult`. If no review exists yet, `ForwardError` naming `run_agent_on_pr`. Read-only/idempotent. | `registerGetFindings(server, client)` |
| `mcp-server/src/tools/get-conventions.ts` | Tool `get_conventions(repo)`: resolve repo → `listConventions` → concise `[{rule, evidence_path, evidence_line?, confidence}]`. Empty list is a valid result (unindexed repo). Read-only/idempotent. | `registerGetConventions(server, client)` |
| `mcp-server/src/tools/get-blast-radius.ts` | Tool `get_blast_radius(repo, pr)`: **pure stub, no HTTP call.** Always returns `{status: "not_implemented", message: "...", hint: "Blast-radius analysis ships in a later lesson. For now use get_conventions or get_findings."}`. Read-only/idempotent. | `registerGetBlastRadius(server)` |
| `mcp-server/src/server.ts` | Composition root: `createMcpServer(config): McpServer`. Build `HttpApiClient`, instantiate `McpServer({name:'devdigest', version})`, call the 5 `registerX` fns. No transport here (testable). | `createMcpServer` |
| `mcp-server/src/index.ts` | Entry point (`bin`). `loadConfig()`, `createMcpServer`, connect a `StdioServerTransport`, `await server.connect(transport)`. Log startup to **stderr only** (stdout is the JSON-RPC channel — never write anything else to stdout). | — (side-effecting main) |
| `mcp-server/test/resolvers.test.ts` | Unit: resolve hit/miss for repo/pr/agent, including forward-error messages + UUID passthrough. Mock `ApiClient`. | — |
| `mcp-server/test/poll.test.ts` | Unit: resolves on done, rejects on timeout, handles failed/cancelled, injected `sleep`/`now`. | — |
| `mcp-server/test/mappers.test.ts` | Unit: `toReviewResult` drops the right fields; `pickReviewForRun` match + fallback. | — |
| `mcp-server/test/tools.test.ts` | Unit: each tool handler end-to-end against a mock `ApiClient` (happy path + forward-error path). `run_agent_on_pr` with a scripted poll sequence. `get_blast_radius` returns the fixed stub. | — |

### Files to modify

None. This package is additive and self-contained. It does NOT get added to any
`modules/index.ts`, tsconfig path alias, or root config.

---

## 2. Dependency changes

**New package deps** (`mcp-server/package.json`) — pin to versions already in
the repo where they overlap (`server/package.json`):

- runtime: `@modelcontextprotocol/sdk` (latest), `zod` `^3.24.1` (MUST be zod v3
  — the MCP SDK's tool schema API peer-depends on zod 3; matches the rest of the
  repo).
- dev: `typescript` `^5.7.2`, `tsx` `^4.19.2`, `vitest` `^2.1.8`,
  `@types/node` (matching Node ≥22).

**No DB migration.** No schema, no `pnpm db:generate`.

**No `@devdigest/shared` change.** The MCP server does NOT vendor or import
shared; it hand-copies the small field subsets it reads into `src/api/types.ts`.
If a consumed contract changes server-side, that subset is the one place to
update (call this out in `AGENTS.md`).

**Env vars** (all optional, read in `config.ts`):
`DEVDIGEST_API_URL` (default `http://localhost:3001`), `DEVDIGEST_RUN_TIMEOUT_MS`
(default `480000`), `DEVDIGEST_POLL_INTERVAL_MS` (default `2000`),
`DEVDIGEST_HTTP_TIMEOUT_MS` (default `30000`).

**Package manager:** use **npm** (`package-lock.json`), matching the two other
standalone leaf packages `reviewer-core/` and `e2e/`. This sidesteps the
documented gotcha (root `server/insights.md`) where running pnpm in a
non-workspace sibling fabricated a stray `pnpm-workspace.yaml`. Confirmed safe:
repo root has only `.npmrc`, no `package.json` / `pnpm-workspace.yaml`, so a new
sibling package with its own lockfile is genuinely standalone.

**Scripts** (`package.json`):
- `"dev": "tsx src/index.ts"`
- `"build": "tsc"`
- `"start": "node dist/index.js"`
- `"typecheck": "tsc --noEmit"`
- `"test": "vitest run"`

**Local registration with an MCP client** (document in README):

```bash
# 1. build once
cd mcp-server && npm install && npm run build
# 2. register with Claude Code (dev stack must be up: ./scripts/dev.sh)
claude mcp add devdigest \
  -e DEVDIGEST_API_URL=http://localhost:3001 \
  -- node /ABSOLUTE/PATH/dev-digest/mcp-server/dist/index.js
```

For a fast dev loop (no build step) the command can be
`-- npx tsx /ABSOLUTE/PATH/dev-digest/mcp-server/src/index.ts`.

---

## 3. Execution order

File lists are disjoint across steps (parallel-safe per root `insights.md`'s
disjoint-ownership rule). Steps 3–5 (tool files) can run in parallel once step 2
lands. Test files are owned by the step that also owns the code they cover,
except the tool test file which is its own step (step 7) to keep tool files
disjoint from one shared test file.

**Step 1 — Package skeleton + config + error type.**
Owns: `mcp-server/package.json`, `mcp-server/tsconfig.json`,
`mcp-server/.gitignore`, `mcp-server/src/config.ts`, `mcp-server/src/errors.ts`.
Depends on: nothing.
Test criteria: `npm install` succeeds; `npm run typecheck` passes on the
skeleton; `loadConfig()` returns defaults when env is unset.

**Step 2 — API port, response types, and HTTP adapter.**
Owns: `mcp-server/src/api/types.ts`, `mcp-server/src/api/client.ts`,
`mcp-server/src/api/http-client.ts`.
Depends on: step 1 (config, errors).
Test criteria: `typecheck` passes; `ApiClient` interface covers all 7 methods;
`HttpApiClient` compiles against global `fetch`; UUID guard rejects a non-UUID
path segment before any request. (No live-server test here — exercised in step 8.)

**Step 3 — Schemas + resolvers + poll + mappers (pure core) with unit tests.**
Owns: `mcp-server/src/schemas.ts`, `mcp-server/src/resolvers.ts`,
`mcp-server/src/poll.ts`, `mcp-server/src/mappers.ts`,
`mcp-server/test/resolvers.test.ts`, `mcp-server/test/poll.test.ts`,
`mcp-server/test/mappers.test.ts`.
Depends on: step 1 (errors), step 2 (`ApiClient` interface + types).
Test criteria: `npm test` green for these three test files; resolver misses
produce forward-error messages naming the correct recovery tool; poll resolves
on `done` and rejects on timeout.

**Step 4 — Tool: list_agents.**
Owns: `mcp-server/src/tools/list-agents.ts`.
Depends on: steps 2, 3.
Test criteria: `typecheck` passes; covered by step 7 tests.

**Step 5 — Tool: run_agent_on_pr + get_findings.**
Owns: `mcp-server/src/tools/run-agent-on-pr.ts`,
`mcp-server/src/tools/get-findings.ts`.
Depends on: steps 2, 3.
Test criteria: `typecheck` passes; covered by step 7 tests.

**Step 6 — Tool: get_conventions + get_blast_radius (stub).**
Owns: `mcp-server/src/tools/get-conventions.ts`,
`mcp-server/src/tools/get-blast-radius.ts`.
Depends on: steps 2, 3 (get_conventions); step 3 schemas only (blast stub).
Test criteria: `typecheck` passes; blast stub returns the exact fixed payload;
covered by step 7 tests.

**Step 7 — Tool handler unit tests.**
Owns: `mcp-server/test/tools.test.ts`.
Depends on: steps 4, 5, 6.
Test criteria: every tool exercised against a mock `ApiClient` — happy path +
one forward-error path each; `run_agent_on_pr` with a scripted multi-poll
sequence ending in `done`; `get_blast_radius` returns the stub with no client
call. `npm test` fully green.

**Step 8 — Composition root, entry point, docs.**
Owns: `mcp-server/src/server.ts`, `mcp-server/src/index.ts`,
`mcp-server/README.md`, `mcp-server/AGENTS.md`, `mcp-server/insights.md`.
Depends on: steps 4, 5, 6 (all `registerX` fns exist).
Test criteria: `npm run build` produces `dist/index.js`; launching
`node dist/index.js` (with `./scripts/dev.sh` up) responds to an MCP
`tools/list` with exactly 5 tools; a manual `list_agents` call returns seeded
agents. This is the only step needing a live stack.

---

## 4. Definition of Done (whole feature)

- [ ] `cd mcp-server && npm run typecheck` passes.
- [ ] `cd mcp-server && npm test` passes (resolvers, poll, mappers, tools).
- [ ] `npm run build` emits `dist/index.js`; `node dist/index.js` starts and
      writes NOTHING to stdout except JSON-RPC (startup logs go to stderr).
- [ ] Registered via `claude mcp add …`, the client lists exactly 5 tools:
      `list_agents`, `run_agent_on_pr`, `get_findings`, `get_conventions`,
      `get_blast_radius`.
- [ ] Tool annotations correct: `run_agent_on_pr` is non-read-only
      (`readOnlyHint:false`); the other four are `readOnlyHint:true,
      idempotentHint:true`. All five `openWorldHint:true` except the blast stub
      (`openWorldHint:false` — no external interaction).
- [ ] Manual, with `./scripts/dev.sh` up + seeded data:
  - `list_agents` returns seeded agents with `{id, name}`.
  - `run_agent_on_pr("<seeded owner/name>", <seeded PR #>, "<seeded agent name>")`
    returns `{verdict, findings:[…slim…]}` after the real run completes.
  - `get_findings(...)` on that PR returns the same slim shape without re-running.
  - `get_conventions("<seeded owner/name>")` returns candidates (or `[]` if the
    repo is unindexed — still a success, not an error).
  - `get_blast_radius(...)` returns the fixed `not_implemented` payload and makes
    no HTTP call.
- [ ] Edge cases verified: unknown repo / PR / agent each return a forward-leading
      error naming the correct next tool; malformed `repo` (not `owner/name`) or
      non-numeric `pr` is rejected by the input schema with an example of the
      correct format; run-timeout returns a forward error pointing at
      `get_findings`.

---

## 5. Risks and assumptions

- **MCP SDK API surface.** Plan assumes the current `@modelcontextprotocol/sdk`
  high-level API: `McpServer` + `server.registerTool(name, {title, description,
  inputSchema (raw zod shape), outputSchema (raw zod shape), annotations},
  handler)` returning `{content:[{type:'text',text}], structuredContent}`, and
  `StdioServerTransport` from `.../server/stdio.js`. If the pinned SDK version
  differs (e.g. `server.tool(...)` signature), the Implementer adapts the
  `registerX` calls but the tool logic/shapes are unaffected. Verify the exact
  import paths against the installed version before writing `server.ts`.
- **Output schema vs structuredContent.** When a tool declares `outputSchema`,
  the SDK requires the handler to return `structuredContent` matching it AND a
  text `content` block (many clients still render text). Each tool returns both:
  `structuredContent` = the concise object; `content` = a short human summary
  (e.g. "request_changes — 3 findings"). Keep the text terse (token cost).
- **Run/review correlation.** `pickReviewForRun` matches `ReviewDto.run_id` to
  the `run_id` from the trigger response. Assumption: a completed run persists a
  review with that `run_id` (holds per `reviews/helpers.ts` — `run_id` is carried
  on the DTO). Fallback to newest `kind:'review'` review guards the rare case
  where correlation is missing.
- **Security (per the `security` skill).**
  - No secrets: the server stores/sends no tokens; auth is intentionally absent
    (`LocalNoAuthProvider`). Nothing to leak.
  - Injection sink = the API base URL path. `repo`/`pr`/`agent` are NEVER
    interpolated raw into a URL — they are resolved to server-issued UUIDs by
    matching against `GET /repos|/agents` lists, and each UUID is validated with
    a UUID regex before being placed in a path segment. This prevents path
    traversal / SSRF via crafted tool args.
  - `DEVDIGEST_API_URL` is developer-controlled and defaults to loopback; document
    that pointing it at a non-local host is the operator's choice. Do not follow
    redirects to other hosts.
  - stdout hygiene: stdio transport uses stdout for JSON-RPC; any stray
    `console.log` corrupts the protocol. All diagnostics go to stderr. Enforced in
    `index.ts` and noted in `AGENTS.md`.
- **`run_agent_on_pr` cost + latency.** It triggers a real, paid LLM run and can
  take minutes. Mitigated by: non-read-only annotation, generous 8-min default
  timeout (env-tunable), and a forward-error on timeout pointing to
  `get_findings` so the caller can poll later rather than the tool hanging.
- **Testability boundary.** Everything except `index.ts` transport wiring and the
  live `dist/index.js` smoke test is unit-testable with a mock `ApiClient` — no
  running server or LLM key needed for `npm test`. The single live-stack check is
  step 8's manual `tools/list` + `list_agents` smoke test.
- **AGENTS.md content** (for step 8): keep ≤100 lines, "map not manual" —
  what it is (local stdio MCP server, HTTP client of :3001, 5 tools), local
  commands (`npm run dev/build/test/typecheck`), conventions (flat layered
  layout, `ApiClient` port + mock, stderr-only logging, hand-copied contract
  subsets in `api/types.ts` kept in sync manually), gotchas (needs `./scripts/dev.sh`
  up; `run_agent_on_pr` spends money; never write to stdout), and a pointer to
  this spec + `server/AGENTS.md` for the API surface.

---

## Open questions

None blocking. All architectural forks (HTTP-not-DB, no-auth, flat args, polling,
concise shapes, forward-leading errors, blast stub) were decided before planning.
The only runtime-verify item is the exact `@modelcontextprotocol/sdk` version's
API shape (see Risks) — resolved by the Implementer reading the installed
package, not a user decision.
