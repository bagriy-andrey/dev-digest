# Spec: Pre-push CLI (local, pre-push review loop)

**Status:** planning
**Scope:** `server/` (new synchronous, unpersisted review endpoint + a shared
agent-runner extraction) and `mcp-server/` (a second `bin` entry — a CLI —
alongside the existing stdio MCP server). One combined spec, owned by neither
package alone, so it lives at repo root `specs/` — mirroring the
`specs/mcp-server.md` convention (a plan that spans a leaf package + the API it
consumes). **No `client/`, no `reviewer-core/`, no DB migration** — every one of
those is explicitly out of scope (§5).

Problem: Blast Radius and all PR review today only run from the PR page, after
code is pushed and a PR is opened. This feature adds a pre-push loop: a developer
runs one command in their working copy, before pushing, and gets the same
structured review the PR page would give — reusing the exact same agents and the
exact same review pipeline, with zero persistence.

Target UX (v1 — no other flags):

```
devdigest review --mode working
```

`--mode working` = bare `git diff` (working tree vs the index — unstaged changes
only, deliberately NOT `git diff HEAD`). `--mode staged` (`git diff --cached`)
and `--mode branch` (committed-but-unpushed) are named future sibling modes: the
three map onto real, non-overlapping git diff boundaries (working dir / index /
local-ahead-of-remote). Only `working` is implemented now; mode dispatch is
structured (a `MODE_DIFF_ARGS` table) so the other two are a small later
addition, not a rewrite.

---

## 0. What already exists (do not touch / do not recreate)

Read from the codebase, not assumed. Every row below is reused as-is.

| Artifact | State | Location (file:line) |
|---|---|---|
| `parseUnifiedDiff(raw)` — plain-`git diff` parser, **no PR-specific assumptions** | ✅ reuse as-is; zero new parsing code | `server/src/adapters/git/diff-parser.ts:14` |
| `ReviewRunExecutor.runOneAgent` — the PR review body: llm resolve → enrichment → `reviewPullRequest` → **persist** | ✅ the source of the extraction (§1.A); persistence stays, enrichment+review call moves out | `server/src/modules/reviews/run-executor.ts:138-344` |
| Enrichment helpers `buildCallersDigest` / `buildRepoMapDigest` / `buildRankNote` — depend only on `repoId` (+`diff` for two), never on `pull`/`PullRow` | ✅ moved verbatim into the shared runner | `run-executor.ts:357-431` |
| `reviewPullRequest(...)` + `countBlockers(findings, failOn)` (pure engine) | ✅ reuse as-is; **no `reviewer-core` change** | `reviewer-core/src/index.ts:39,53` · impl `reviewer-core/src/output/to-review.ts:48` |
| `ReviewOutcome` (`{ review: Review, grounding, dropped, mode, assembly, chunks, tokensIn, tokensOut, costUsd, raw }`) | ✅ the runner's return type | `reviewer-core/src/review/run.ts:101-120` |
| `Review` (`{ verdict: Verdict, summary, score, findings: Finding[] }`) + `Finding` + `Verdict` contracts | ✅ vendored; the new response contract composes `Finding`/`Verdict` | `server/src/vendor/shared/contracts/findings.ts:26,45,64` |
| `taskLine(pull)` — the ONLY PR-shaped input to the review; a fixed substitute is needed for the endpoint (§1.A) | ✅ reference | `server/src/modules/reviews/helpers.ts:82` |
| `agentsRepo.listEnabled(workspaceId)` — "run all enabled agents" (there is NO `isDefault`/`isPrimary`; `resolveTargets({all:true})` already uses this) | ✅ the only sane default = run all enabled | `server/src/modules/agents/repository.ts:65` · call-site `reviews/service.ts:48` |
| `agent.ciFailOn` (`'never'\|'critical'\|'warning'\|'any'`) + `agent.repoIntel` + `agent.strategy` columns | ✅ per-agent gate + toggles the runner already honors | `server/src/db/schema/agents.ts:20,25,31` |
| `RepoRepository.getById(workspaceId, id)` — workspace-scoped repo lookup (the A01 tenancy guard; cross-module use is an established pattern) | ✅ reuse for 404 | `server/src/modules/repos/repository.ts:36` · precedent `intent/service.ts:42,151` |
| `getContext(container, req)` → `{ workspaceId }` (`LocalNoAuthProvider` resolves a default workspace regardless of headers) | ✅ every route uses it | `server/src/modules/_shared/context.ts` |
| `IdParams` + `fastify-type-provider-zod` route pattern; `POST /pulls/:id/review` rate-limited 10/min | ✅ the exact route+ratelimit shape to mirror | `server/src/modules/reviews/routes.ts:27-29` |
| Vendored-shared barrel (`export * from './contracts/*.js'`) | ✅ add one line for the new contract file | `server/src/vendor/shared/index.ts` |
| Module registry — reviews already registered; routes declare full paths (no prefix) so `/repos/:id/review-diff` can live inside the reviews module | ✅ no `modules/index.ts` change needed | `server/src/modules/index.ts` · registration `server/src/app.ts:170` |
| `ApiClient` port + `HttpApiClient` adapter with `assertUuid` injection-sink guard + `redirect:'error'` + per-call `AbortController` timeout | ✅ extend with one `reviewDiff` method | `mcp-server/src/api/client.ts` · `mcp-server/src/api/http-client.ts` |
| `ApiClient.listRepos()` → `RepoDto[]` with `full_name` (client-side repo match; NO new server lookup-by-name route needed) | ✅ reuse for repo auto-detect | `mcp-server/src/api/client.ts:22` · `mcp-server/src/api/types.ts:20` |
| Injected-port test pattern (`poll.ts` injects `now`/`sleep`; tools tested against a mock `ApiClient`) | ✅ the pattern the git port + CLI orchestration mirror | `mcp-server/src/poll.ts:23-30` · `mcp-server/test/tools.test.ts` |
| `mcp-server/src/config.ts` reads `DEVDIGEST_API_URL` (default `http://localhost:3001`) | ✅ CLI reuses it unchanged | `mcp-server/src/config.ts:28` |

### Gotchas baked in from insights + the code (read once, apply throughout)

- **The extraction must be behaviour-preserving for the PR flow.** `run-executor.ts`'s
  own doc-comment stresses "extracted … behaviour unchanged." The shared runner
  must produce the *identical* `ReviewOutcome` and the *identical* SSE Live-Log
  events for the PR path. Achieved by passing the existing `RunLogger` into the
  runner as an optional `log` (it structurally satisfies the tiny `AgentRunLog`
  interface — `RunLogger.info(msg)` + `RunLogger.step(label, fn, opts)` already
  match, `run-logger.ts:55,82`) and threading `onEvent`/`checkCancelled` through
  unchanged. The endpoint passes a no-op log and omits `onEvent`/`checkCancelled`.
- **The extraction STOPS before persistence.** `runOneAgent`'s `insertReview` /
  `insertFindings` / `completeAgentRun` / `saveRunTrace` / `runBus.complete` stay
  in `runOneAgent`. The new endpoint calls the shared runner and then maps to a
  response — it creates **no** `agent_runs`, `reviews`, `findings`, `run_traces`
  rows and touches **no** `runBus`/SSE. Fully ephemeral (design decision,
  confirmed).
- **Intent + `prDescription` are PR-shaped, enrichment is not.** `storedIntent`
  is keyed by `pull.id` and `pull.body` is PR-shaped; both are passed *into* the
  runner as optional params (PR flow supplies them, endpoint supplies neither).
  The three enrichment helpers depend only on `repoId`/`diff`, so they move into
  the shared runner wholesale.
- **`taskLine` is the only PR-shaped instruction.** Do NOT replace it with a bare
  string that loses the review guidance ("review the ENTIRE diff", "never
  withhold a security/correctness finding", "zero findings is valid"). Add a
  sibling `workingTreeTaskLine()` in `helpers.ts` that keeps that guidance and
  only swaps the "Review pull request #N …" lead-in for a working-tree lead-in.
- **"Run all enabled agents" is the correct default, not "pick one."** There is no
  default-agent concept in the schema. The endpoint resolves
  `agentsRepo.listEnabled(workspaceId)` (matching the PR page's "run all"), 400s
  if that list is empty.
- **mcp-server cannot import `@devdigest/shared`** (`mcp-server/AGENTS.md`): the
  CLI's response types are hand-copied field subsets in `src/api/types.ts`, kept
  in sync by hand — same convention the existing 5 tools follow.
- **The CLI bin, unlike `index.ts`, MAY write to stdout.** `index.ts` is the
  JSON-RPC stdio transport and is stderr-only; `cli.ts` is a normal program and
  writes results to stdout, diagnostics to stderr. Keep the two entry points'
  stdout rules distinct and documented.
- **Exit code reuses the server-computed gate, not a re-derivation.** The endpoint
  returns a per-agent `blockers` count (from `countBlockers(findings,
  agent.ciFailOn)` — each agent's own gate). The CLI exits non-zero iff any
  agent's `blockers > 0`; it does NOT re-implement severity ranking client-side
  (it can't import `reviewer-core`). CRITICAL findings are a subset since the
  default `ciFailOn` is `'critical'`.

---

## 1. Module breakdown (dependency order: server contract/runner → server endpoint → mcp CLI)

### 1.A `server/` — new vendored contract, agent-runner extraction, review-diff endpoint

**Create `server/src/vendor/shared/contracts/review-diff.ts`** (new vendored
contract — `zod`, composes existing `Finding`/`Verdict`; kept minimal because it
never needs to survive a page reload, so it does NOT reuse the heavier persisted
`ReviewRecord`/`ReviewDto` shape):

```ts
import { z } from 'zod';
import { Finding, Verdict } from './findings.js';

export const ReviewDiffRequest = z.object({ diff: z.string().min(1) });
export type ReviewDiffRequest = z.infer<typeof ReviewDiffRequest>;

export const AgentReviewResult = z.object({
  agent: z.object({ id: z.string(), name: z.string() }),
  verdict: Verdict,                 // Review.verdict is always present (non-null)
  score: z.number().int().min(0).max(100),
  blockers: z.number().int().min(0),
  findings: z.array(Finding),
});
export type AgentReviewResult = z.infer<typeof AgentReviewResult>;

// The endpoint returns the array directly (no wrapper object) — matches the
// decided response shape. fastify-type-provider-zod serializes a top-level array.
export const ReviewDiffResponse = z.array(AgentReviewResult);
export type ReviewDiffResponse = z.infer<typeof ReviewDiffResponse>;
```

- **Only the `server/` vendored copy is edited.** The `client/` vendored copy is
  NOT mirrored — the Next.js UI never calls this endpoint (CLI-only feature). This
  is the one intentional exception to the "mirror both copies by hand" rule, and
  it is safe precisely because no client code imports `ReviewDiffResponse`.

**Modify `server/src/vendor/shared/index.ts`** — add one line to the barrel:
`export * from './contracts/review-diff.js';` (server copy only, per above).

**Create `server/src/modules/reviews/agent-runner.ts`** (the shared,
behaviour-preserving extraction — the mechanism that guarantees "same agent, same
logic" instead of duplication):

- `export interface AgentRunLog { info(msg: string): void; step<T>(label: string,
  fn: () => T | Promise<T>, opts?: { kind?: string }): Promise<T>; }` — the tiny
  logging surface the runner needs. `RunLogger` already satisfies it structurally.
- `const NOOP_LOG: AgentRunLog = { info() {}, async step(_l, fn) { return fn(); } };`
- `export interface RunAgentReviewOpts { repoId: string; diff: UnifiedDiff; agent:
  AgentRow; taskPrefix: string; sessionId: string; prDescription?: string; intent?:
  { summary: string; inScope: string[]; outOfScope: string[] };
  onEvent?: (e: { kind: RunEventKind; msg: string; data?: unknown }) => void;
  checkCancelled?: () => void; log?: AgentRunLog; }`
- `export async function runAgentReview(container: Container, opts:
  RunAgentReviewOpts): Promise<ReviewOutcome>` — the body lifted verbatim from
  `runOneAgent`'s middle section (`run-executor.ts:155-240`):
  1. `const log = opts.log ?? NOOP_LOG;`
  2. `const llm = await log.step('Resolving ${agent.provider} provider', () =>
     container.llm(agent.provider as Provider), { kind: 'tool' });`
  3. Enrichment, gated on `agent.repoIntel !== false` exactly as today:
     `buildCallersDigest(container, repoId, diff, log)`,
     `buildRepoMapDigest(container, repoId, log)`,
     `buildRankNote(container, repoId, diff, log)`.
  4. `const task = opts.taskPrefix + rankNote;`
  5. Skills: `container.agentsRepo.linkedSkills(agent.id)` → filter enabled →
     `enabledSkillBodies` (unchanged logic).
  6. `return reviewPullRequest({ systemPrompt, model, diff, llm, strategy:
     agent.strategy ?? REVIEW_STRATEGY, ...(skills), ...(callers), ...(repoMap),
     ...(opts.prDescription ? { prDescription: opts.prDescription } : {}),
     ...(opts.intent ? { intent: opts.intent } : {}), task, sessionId:
     opts.sessionId, ...(opts.onEvent ? { onEvent: opts.onEvent } : {}),
     ...(opts.checkCancelled ? { checkCancelled: opts.checkCancelled } : {}) });`
- **Move** `buildCallersDigest` / `buildRepoMapDigest` / `buildRankNote` here as
  module-private functions taking `(container, repoId, [diff,] log: AgentRunLog)`
  — verbatim bodies, `this.container` → `container`, `runLog` → `log`.

**Modify `server/src/modules/reviews/run-executor.ts`** — `runOneAgent` keeps its
signature, its try/catch, and ALL persistence. Replace only its middle
(`:155-240`: llm resolve + enrichment + task + skills + `reviewPullRequest`) with:

```ts
const storedIntent = await this.repo.getIntent(pull.id);
if (storedIntent) runLog.info('Intent: injecting stored PR intent/scope …');
else runLog.info('Intent: none stored for this PR …');
const outcome = await runAgentReview(this.container, {
  repoId: pull.repoId, diff, agent,
  taskPrefix: taskLine(pull),
  sessionId: `${repo.owner}/${repo.name}#${pull.number}:${agent.name}`,
  ...(pull.body ? { prDescription: pull.body } : {}),
  ...(storedIntent ? { intent: { summary: storedIntent.intent,
    inScope: storedIntent.in_scope, outOfScope: storedIntent.out_of_scope } } : {}),
  onEvent: (e) => runLog.event(e.kind, e.msg, e.data),
  checkCancelled: () => { if (this.container.runBus.isCancelled(runId))
    throw new RunCancelledError(); },
  log: runLog,
});
```

Then delete the three now-moved private enrichment methods. Everything from
`const { tokensIn … } = outcome;` down (persistence, trace, bus) is unchanged.

**Modify `server/src/modules/reviews/helpers.ts`** — add
`export function workingTreeTaskLine(): string` returning the same guidance
paragraph as `taskLine` but with the lead sentence replaced by:
`"Review this local working-tree diff (a pre-push review requested by the author
before pushing). "` followed by the identical "Report only the distinct,
high-value findings … Review the ENTIRE diff. Never withhold … security or
correctness finding …" body. (Do not reference a PR number/title/author.)

**Create `server/src/modules/reviews/review-diff.ts`** — `ReviewDiffService`
(mirrors `IntentService`'s DI shape):

- `constructor(private container: Container)` → `this.repos = new
  RepoRepository(container.db);`
- `async run(workspaceId: string, repoId: string, diff: string):
  Promise<AgentReviewResult[]>`:
  1. **Empty/whitespace guard:** if `diff.trim().length === 0` → throw
     `AppError('empty_diff', 'Diff is empty', 400)` (belt-and-suspenders over the
     route's `z.string().min(1)`, which does not catch whitespace-only).
  2. **Repo 404 (tenancy):** `const repo = await this.repos.getById(workspaceId,
     repoId)`; if absent → `NotFoundError('Repo not found')`.
  3. **Agents:** `const agents = await this.container.agentsRepo.listEnabled(
     workspaceId)`; if `agents.length === 0` → `AppError('no_enabled_agents',
     'Repo has no enabled agents', 400)`.
  4. **Parse:** `const parsed = parseUnifiedDiff(diff)`; if
     `parsed.files.length === 0` → `AppError('unparseable_diff', 'Diff contained
     no recognizable file changes', 400)` (don't spend an LLM call on nothing).
  5. **Run each agent sequentially** (mirrors the PR executor's sequential loop —
     avoids a fan-out cost/rate spike; a `Promise.all` parallelization is a noted
     future option). Per-agent try/catch **isolates failures** (same as the PR
     page): on error, `req.log`-style log via an injected logger and skip that
     agent. Each success:
     `const outcome = await runAgentReview(this.container, { repoId, diff: parsed,
     agent, taskPrefix: workingTreeTaskLine(), sessionId:
     \`${repo.owner}/${repo.name}:working:${agent.name}\` });` (no log, no
     `onEvent`, no `intent`, no `prDescription`).
     Map: `{ agent: { id: agent.id, name: agent.name }, verdict:
     outcome.review.verdict, score: outcome.review.score, blockers:
     countBlockers(outcome.review.findings, agent.ciFailOn), findings:
     outcome.review.findings }`.
  6. If **every** agent failed (zero successes) → throw
     `AppError('review_failed', 'All agents failed to produce a review', 502)`
     so the caller sees a failure, not a misleading empty-200. Otherwise return
     the collected results.
- Accept an optional `logger?: Logger` param (the Fastify `req.log`) so per-agent
  failures are logged; do not swallow silently.

**Modify `server/src/modules/reviews/routes.ts`** — add one route (mirrors the
`POST /pulls/:id/review` rate-limit exactly):

```ts
app.post('/repos/:id/review-diff',
  { schema: { params: IdParams, body: ReviewDiffRequest, response: { 200: ReviewDiffResponse } },
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
  async (req) => {
    const { workspaceId } = await getContext(container, req);
    return new ReviewDiffService(container).run(workspaceId, req.params.id, req.body.diff, req.log);
  });
```

Import `ReviewDiffRequest`, `ReviewDiffResponse` from `@devdigest/shared` and
`ReviewDiffService` from `./review-diff.js`. **No `modules/index.ts` change** —
the reviews module is already registered and routes declare full paths.

> Security (per `security` skill): input is `{ diff: string }` (bounded by
> validation + the whitespace/parse guards); `repoId` comes from the URL path and
> is resolved through the workspace-scoped `getById` (tenancy guard — a repo in
> another workspace 404s, not leaks). The diff text is untrusted PR-author-style
> content, but it only ever flows into `parseUnifiedDiff` and the prompt, where
> `reviewPullRequest`/`assemblePrompt` already wrap+truncate untrusted text (same
> path the PR flow's `prDescription` uses). No secret is read or returned; the LLM
> key stays server-side. Rate-limited 10/min because this triggers real paid LLM
> calls.

### 1.B `mcp-server/` — new CLI bin (second entry point, additive to the MCP package)

Flat layered layout, imports point inward only (mirrors the existing package):
`api/types.ts` (pure) ← `git.ts` (port + pure parser) ← `cli/format.ts` (pure) ←
`cli/review.ts` (orchestration, depends on the `ApiClient` + `GitPort` ports) ←
`cli.ts` (entry/bin, composition root for the CLI).

**Modify `mcp-server/src/api/types.ts`** — add hand-copied subsets mirroring the
new server contract (source-of-truth comment pointing at
`server/src/vendor/shared/contracts/review-diff.ts`):

```ts
export interface ReviewDiffFinding {
  id: string; severity: string; category: string; title: string;
  file: string; start_line: number; end_line: number;
  rationale: string; suggestion?: string | null; confidence: number;
}
export interface AgentReviewResult {
  agent: { id: string; name: string };
  verdict: 'request_changes' | 'approve' | 'comment';
  score: number; blockers: number; findings: ReviewDiffFinding[];
}
```

(Response is `AgentReviewResult[]`.)

**Modify `mcp-server/src/api/client.ts`** — add to the `ApiClient` port:
`reviewDiff(repoId: string, diff: string): Promise<AgentReviewResult[]>;` —
`POST /repos/:id/review-diff`, synchronous (unlike `triggerReview`, the findings
ARE in this response — no polling).

**Modify `mcp-server/src/api/http-client.ts`** — implement `reviewDiff`:
`assertUuid(repoId, 'repoId'); return this.request<AgentReviewResult[]>('POST',
\`/repos/${repoId}/review-diff\`, { diff }, 'Repo');` (the `assertUuid` guard
applies — `repoId` is a server-issued UUID from `listRepos`, never a raw string;
`redirect:'error'` + timeout inherited from `request`).

**Create `mcp-server/src/git.ts`** — git integration behind a port (mirrors
`poll.ts`'s inject-for-testability pattern):

- `export type ReviewMode = 'working' | 'staged' | 'branch';`
- `export const MODE_DIFF_ARGS: Record<ReviewMode, string[] | null> = { working:
  ['diff'], staged: ['diff', '--cached'], branch: null };` — `working` = bare
  `git diff` (working tree vs index, NOT `HEAD`). `branch` = `null` = not
  implemented in v1 (the orchestrator throws a clear "mode not yet implemented"
  error for it).
- `export interface GitPort { diff(mode: ReviewMode): Promise<string>;
  remoteUrl(): Promise<string>; }` — the injectable port.
- `export function createGitPort(cwd: string): GitPort` — the shell adapter: uses
  `node:child_process` `execFile('git', args, { cwd, maxBuffer })` (NOT `exec`
  with a string — avoids shell interpolation, an injection-sink guard). `diff`
  looks up `MODE_DIFF_ARGS[mode]` (throws for a `null`/unknown mode);
  `remoteUrl` runs `git remote get-url origin` (fallback `git config --get
  remote.origin.url`).
- `export function parseRemoteUrl(url: string): { owner: string; name: string } |
  null` — **pure**, unit-tested. Parses SSH (`git@github.com:owner/name.git`),
  HTTPS (`https://github.com/owner/name.git`), and `.git`-less / trailing-slash
  variants; returns `null` on anything unrecognized. Case-preserving.

**Create `mcp-server/src/cli/format.ts`** — pure terminal rendering + exit-code
policy (no I/O; fully unit-testable):

- `export const SEVERITY_ORDER = ['CRITICAL', 'WARNING', 'SUGGESTION'] as const;`
- `export function formatResults(results: AgentReviewResult[]): string` — per
  agent: a header line (`agent.name` — `verdict`, `score`, `blockers`), then
  findings grouped by severity in `SEVERITY_ORDER`, each rendered as
  `file:start_line` + title + rationale in readable plain text. A clean agent
  (no findings) renders a one-line "no findings".
- `export function hasBlockingFindings(results: AgentReviewResult[]): boolean` →
  `results.some(r => r.blockers > 0)` — the server-computed gate, not a client
  re-derivation.

**Create `mcp-server/src/cli/review.ts`** — orchestration, deps injected (unit-
tested against a mock `ApiClient` + mock `GitPort`, no real shelling/HTTP):

```ts
export interface ReviewDeps {
  api: ApiClient; git: GitPort; mode: ReviewMode;
  out: (line: string) => void; err: (line: string) => void;
}
export async function runReview(deps: ReviewDeps): Promise<number> { … }
```

Flow (return value = process exit code):
1. `const diff = await git.diff(mode);` — **empty-diff short-circuit:** if
   `diff.trim() === ''` → `out('No local changes to review.')` → return `0`
   (WITHOUT calling the API).
2. `const remote = await git.remoteUrl(); const parsed = parseRemoteUrl(remote);`
   if `null` → `err('Could not determine the origin remote (owner/name).')` →
   return `2`.
3. `const repos = await api.listRepos(); const match = repos.find(r =>
   r.full_name === \`${parsed.owner}/${parsed.name}\`);` if none →
   `err("this repo isn't imported into DevDigest yet — import it in the studio
   first")` → return `2`.
4. `const results = await api.reviewDiff(match.id, diff);`
5. `out(formatResults(results));`
6. `return hasBlockingFindings(results) ? 1 : 0;`

**Create `mcp-server/src/cli.ts`** — the bin entry (`#!/usr/bin/env node`
shebang; free to write stdout, unlike `index.ts`):

- Minimal hand-rolled argv parse (no new dependency — matches the package's
  zero-extra-deps posture): expect `review` subcommand + optional
  `--mode <working|staged|branch>` (default `working`). Unknown subcommand/flag or
  a bad mode → usage text to stderr, `process.exit(2)`.
- `const config = loadConfig(); const api = createApiClient(config); const git =
  createGitPort(process.cwd());` then `const code = await runReview({ api, git,
  mode, out: s => process.stdout.write(s + '\n'), err: s =>
  process.stderr.write(s + '\n') }); process.exit(code);`
- Top-level try/catch: on a thrown `Error` (network, `ForwardError`, git failure)
  → write the message to stderr, `process.exit(2)`. Meaningful exit codes:
  `0` = clean, `1` = blocking findings, `2` = usage/resolution/infra error — so it
  is usable verbatim as a `.git/hooks/pre-push` script later (wiring the hook
  itself is out of scope).

**Modify `mcp-server/package.json`** — add `"bin": { "devdigest": "dist/cli.js" }`
(the package previously had no `bin`). Optionally a `"cli": "tsx src/cli.ts"`
script for the dev loop. No new dependencies.

**Modify `mcp-server/AGENTS.md`** (≤100 lines, "map not manual") — the package is
now "a stdio MCP server (5 tools) AND a `devdigest` CLI bin", not just "5 tools".
Add: the CLI's flat sub-layout (`git.ts` port, `cli/` orchestration+format,
`cli.ts` bin); the stdout rule difference (`cli.ts` MAY write stdout, `index.ts`
may NOT); the exit-code contract; `git.ts` shells via `execFile` (no shell
string). Keep the existing MCP content.

**Modify `mcp-server/README.md`** — add a CLI section: install via
`cd mcp-server && npm install && npm run build && npm link` (or `npm install -g .`)
for a global `devdigest` command usable from any locally-imported repo; dev loop
via `npx tsx src/cli.ts review --mode working` (no build);
`DEVDIGEST_API_URL` points at a non-default API host if needed; the three modes
(only `working` live in v1); the exit-code contract + a note that it can back a
`pre-push` hook.

---

## 2. Dependency changes

- **New packages:** none (server reuses existing deps; the CLI hand-rolls argv
  parsing and uses `node:child_process` — no new npm dependency in either
  package).
- **DB migration:** none. The endpoint is fully ephemeral — no `agent_runs`,
  `reviews`, `findings`, or `run_traces` rows. No `pnpm db:generate`/`db:migrate`.
- **Vendored `@devdigest/shared`:** one **new** file
  `server/src/vendor/shared/contracts/review-diff.ts` + one barrel line in
  `server/src/vendor/shared/index.ts`. **Server copy only** — the `client/`
  vendored copy is intentionally NOT mirrored (the UI never calls this endpoint;
  §1.A). The `mcp-server/` package does not vendor shared at all — it hand-copies
  the response subset into `src/api/types.ts` (existing convention).
- **Env vars:** none new. The CLI reuses `DEVDIGEST_API_URL` (already in
  `config.ts`); the endpoint reuses the existing LLM provider keys/machinery via
  `container.llm(...)`.
- **`package.json` bin:** `mcp-server` gains a `bin` entry (`devdigest`). Install
  as documented (`npm link` / `-g`).

---

## 3. Execution order (disjoint file ownership per step → parallel-safe)

File lists are disjoint across steps. Server steps S1 and S2 are independent
(parallel); S3 depends on both. mcp steps M1 and M2 are independent (parallel);
M3 depends on M1+M2; M4 depends on M1+M2+M3. The mcp cluster (M1–M3) can be built
in parallel with the server cluster because the CLI's response types are
hand-copied against the contract shape in §1.A — only M4's live smoke test needs
server S3 deployed.

**Step S1 — server: new vendored review-diff contract.**
Owns: `server/src/vendor/shared/contracts/review-diff.ts`,
`server/src/vendor/shared/index.ts`.
Depends on: nothing.
Test: `cd server && pnpm typecheck` (the barrel re-exports cleanly;
`ReviewDiffResponse`/`AgentReviewResult`/`ReviewDiffRequest` compile against the
existing `Finding`/`Verdict`).

**Step S2 — server: agent-runner extraction (behaviour-preserving).**
Owns: `server/src/modules/reviews/agent-runner.ts` (new),
`server/src/modules/reviews/run-executor.ts` (modify),
`server/src/modules/reviews/agent-runner.test.ts` (hermetic — plain `.test.ts`,
mocks `container.llm`/`container.repoIntel`/`container.agentsRepo`).
Depends on: nothing (independent of S1).
Test: `cd server && pnpm typecheck` + existing reviews tests still green
(`pnpm exec vitest run --exclude '**/*.it.test.ts'`). Unit-assert: `runAgentReview`
with `agent.repoIntel === false` omits all enrichment (prompt identical to the
repo-intel-off baseline); with a mock `repoIntel` returning callers/repoMap/rank,
those sections are present; `taskPrefix` + rankNote compose the task; a no-op log
+ omitted `onEvent`/`checkCancelled` run without error. **Behaviour-unchanged
check:** the PR flow's `runOneAgent` still persists a review + findings + trace
(existing run-executor tests must pass unmodified).

**Step S3 — server: review-diff endpoint (service + route + task helper + it-test).**
Owns: `server/src/modules/reviews/review-diff.ts` (new),
`server/src/modules/reviews/helpers.ts` (modify: add `workingTreeTaskLine`),
`server/src/modules/reviews/routes.ts` (modify: add the route),
`server/test/review-diff.it.test.ts` (real PG → `.it.test.ts` suffix per
`TESTING.md`; LLM stubbed via `ContainerOverrides.llm` returning a canned
`Review`).
Depends on: S1 (contract), S2 (`runAgentReview`).
Test: `cd server && pnpm typecheck && pnpm exec vitest run .it.test`. Seed a repo
+ ≥1 enabled agent; override `container.llm` with a mock structured provider
returning a fixed `Review` (one CRITICAL finding). Assert `POST
/repos/:id/review-diff { diff }`: (a) validates against `ReviewDiffResponse` (an
array of `{agent, verdict, score, blockers, findings}`); (b) `blockers` reflects
`countBlockers` under the agent's `ciFailOn`; (c) 404 for a repoId outside the
workspace; (d) 400 for an empty/whitespace-only diff; (e) 400 when the workspace
has zero enabled agents; (f) 400 for a non-empty but unparseable diff;
(g) persists **nothing** (no new `agent_runs`/`reviews`/`findings` rows after the
call — assert counts unchanged); (h) rate-limit config present (10/min).

**Step M1 — mcp: `reviewDiff` on the ApiClient port + adapter + response types.**
Owns: `mcp-server/src/api/types.ts` (modify),
`mcp-server/src/api/client.ts` (modify),
`mcp-server/src/api/http-client.ts` (modify).
Depends on: S1/S3 for the live contract shape (buildable in parallel against the
§1.A shape; only M4 runtime-verifies against the endpoint).
Test: `cd mcp-server && npm run typecheck` — `reviewDiff` compiles on both port
and adapter; `assertUuid(repoId)` guards the path; body is `{ diff }`.

**Step M2 — mcp: git port + remote-URL parser + unit tests.**
Owns: `mcp-server/src/git.ts` (new), `mcp-server/test/git.test.ts` (new).
Depends on: nothing.
Test: `cd mcp-server && npm test` for `git.test.ts` — `parseRemoteUrl` handles
SSH, HTTPS, `.git`-less, trailing-slash, and returns `null` on garbage;
`MODE_DIFF_ARGS.working === ['diff']`, `staged === ['diff','--cached']`,
`branch === null`; the shell adapter's `diff('branch')` throws a clear
not-implemented error. (Mocked/table-driven — no real `git` invocation.)

**Step M3 — mcp: CLI orchestration + formatting + unit tests.**
Owns: `mcp-server/src/cli/review.ts` (new), `mcp-server/src/cli/format.ts` (new),
`mcp-server/test/cli-review.test.ts` (new).
Depends on: M1 (`ApiClient.reviewDiff` + `AgentReviewResult`), M2 (`GitPort`,
`ReviewMode`, `parseRemoteUrl`).
Test: `cd mcp-server && npm test` for `cli-review.test.ts` — `runReview` against a
mock `ApiClient` + mock `GitPort`: empty diff → prints "No local changes to
review.", returns `0`, and `api.reviewDiff` is NOT called; unresolvable remote →
returns `2`; repo not in `listRepos` → prints the "not imported" message, returns
`2`; a result with `blockers > 0` → returns `1`; a clean result → returns `0`;
`formatResults` groups by `CRITICAL`/`WARNING`/`SUGGESTION` and renders
`file:start_line` + title + rationale.

**Step M4 — mcp: CLI entry/bin + docs + live smoke test.**
Owns: `mcp-server/src/cli.ts` (new), `mcp-server/package.json` (modify: `bin`),
`mcp-server/AGENTS.md` (modify), `mcp-server/README.md` (modify).
Depends on: M1, M2, M3 (and server S3 deployed for the live check).
Test: `cd mcp-server && npm run build` emits `dist/cli.js` (with the shebang);
argv parse rejects unknown flags with exit 2. Live (with `./scripts/dev.sh` up +
a locally-imported repo checked out with uncommitted changes): `npx tsx
src/cli.ts review --mode working` prints grouped findings and exits `1` when a
CRITICAL/blocking finding exists, `0` when clean; run in a repo with no local
changes prints "No local changes to review." and exits `0`; run in a repo not
imported into DevDigest prints the import hint and exits `2`.

---

## 4. Definition of Done (whole feature)

Typecheck / tests:
- [ ] `cd server && pnpm typecheck` and `pnpm test` (unit incl.
      `agent-runner.test.ts` + the new `review-diff.it.test.ts`).
- [ ] `cd mcp-server && npm run typecheck` and `npm test` (git + cli-review).
- [ ] `cd mcp-server && npm run build` emits `dist/cli.js` and `dist/index.js`.
- [ ] No `pnpm db:generate` diff (no schema change — if one appears, something
      was touched that shouldn't have been).

Behavioural:
- [ ] `POST /repos/:id/review-diff { diff }` on a seeded repo returns one
      `{agent, verdict, score, blockers, findings}` entry per enabled agent, using
      the SAME pipeline as the PR page (extraction verified: the PR flow still
      persists reviews/findings/traces unchanged).
- [ ] The endpoint persists nothing (row counts for `agent_runs`/`reviews`/
      `findings`/`run_traces` are unchanged after a call).
- [ ] Endpoint validation: 404 unknown/foreign-workspace repo; 400 empty or
      whitespace-only diff; 400 zero enabled agents; 400 unparseable diff;
      502 only if every agent fails.
- [ ] `devdigest review --mode working` in a locally-imported repo with unstaged
      changes prints findings grouped by severity (`file:start_line` + title +
      rationale) and exits `1` on any blocking finding, `0` when clean.
- [ ] Empty working-tree diff → "No local changes to review.", exit `0`, no API
      call.
- [ ] Repo not imported → the "import it in the studio first" hint, non-zero exit.
- [ ] Remote-URL parsing handles both SSH and HTTPS `origin` forms.
- [ ] `--mode staged`/`--mode branch` are recognized as future modes: dispatch is
      table-driven; `branch` errors clearly as not-yet-implemented rather than
      doing the wrong thing.

Docs / hygiene:
- [ ] `mcp-server/AGENTS.md` reflects "stdio MCP server + `devdigest` CLI bin"
      (≤100 lines); `mcp-server/README.md` documents install/`npm link`, the dev
      loop, `DEVDIGEST_API_URL`, and the exit-code contract.
- [ ] `cli.ts` writes results to stdout; only `index.ts` remains stderr-only.

---

## 5. Risks and assumptions

- **Behaviour-preserving extraction is the load-bearing risk.** If `runAgentReview`
  drifts from `runOneAgent`'s current middle section (e.g. a dropped omit-when-
  empty spread, or a lost SSE `.step` event), the PR flow regresses subtly. Mitigation:
  the extraction is a verbatim lift; `RunLogger` is passed in as `log` so the PR
  path's Live-Log events are byte-identical; existing run-executor tests must pass
  unmodified (S2 gate). Do the extraction (S2) and the new endpoint (S3) as
  separate steps so a regression is attributable.
- **`ReviewOutcome.review.findings` are the GROUNDED findings** (survived the
  citation gate) — the same set the PR page shows. The endpoint returns exactly
  these; no separate grounding pass. Assumption confirmed via `reviewer-core/src/
  review/run.ts:215`.
- **Sequential agent execution** is chosen to mirror the PR executor and avoid a
  cost/rate spike from fanning N enabled agents at once. For a large agent roster
  this makes the CLI slower; a bounded `Promise.all` is a clean future
  optimization (noted, not built). Per-agent failure isolation matches the PR
  page's behaviour; a 502 only when *all* agents fail keeps the caller honest.
- **`agentsRepo.listEnabled` is workspace-scoped, not repo-scoped** — there is no
  repo→agent link in the schema, so "all enabled agents for the repo" resolves to
  "all enabled agents in the workspace" (exactly what `resolveTargets({all:true})`
  does today). If a future lesson adds per-repo agent scoping, this call is the one
  line to narrow.
- **Security.** Endpoint: untrusted diff flows only into `parseUnifiedDiff` + the
  prompt (already wrap/truncate untrusted text); `repoId` is workspace-scoped via
  `getById` (cross-workspace 404, no leak); no secret read/returned; rate-limited
  10/min (paid LLM). CLI: git is invoked via `execFile` (arg array, no shell
  string — no command injection); `repoId` sent to the API is a server-issued UUID
  guarded by `assertUuid`; `redirect:'error'` + per-call timeout inherited from
  the existing `HttpApiClient.request`. `DEVDIGEST_API_URL` is developer-controlled
  and defaults to loopback.
- **Client vendored-shared copy is intentionally NOT updated.** This diverges from
  the repo's "mirror both copies by hand" rule, and is safe only because no
  `client/` code imports `ReviewDiffResponse`. If the UI ever grows a pre-push
  view, the contract must then be mirrored into `client/src/vendor/shared`.
- **`git remote get-url origin` may be absent** (no `origin`, or a fork remote
  named differently). v1 handles only `origin`; a missing/garbage remote yields
  the exit-2 "could not determine origin" path rather than a crash. Multi-remote
  selection is out of scope.
- **`--mode branch` semantics** ("committed-but-unpushed", i.e.
  local-ahead-of-remote) are named but unimplemented; the exact git invocation
  (`git diff @{push}` vs `git diff @{upstream}...HEAD`) is deferred to the step
  that implements it. v1 must not guess — `MODE_DIFF_ARGS.branch` is `null` and
  errors clearly.

---

## 6. Out of scope (explicit — do not silently attempt or drop)

- **No persistence** of the pre-push review (no rows, no SSE, no run trace).
- **No `--mode staged` / `--mode branch` implementation** in v1 — only the
  table-driven dispatch that makes them a small later addition.
- **No new server lookup-by-name route** — repo resolution is client-side against
  `listRepos()` (`RepoRepository.findByFullName` exists but stays unexposed).
- **No `reviewer-core` change** — `reviewPullRequest`/`countBlockers` reused as-is.
- **No `client/` change** and **no `client/` vendored-shared mirror** (CLI-only).
- **No 6th MCP tool** — the CLI is a second `bin`, not an MCP tool; the existing
  5 tools are untouched.
- **No git-hook wiring** — the exit-code contract makes a `pre-push` hook
  possible, but installing one is left to the user/a later step.
- **No new npm dependency** in either package (hand-rolled argv parse,
  `node:child_process` for git).
- **No DB schema / migration change.**

---

## Open questions

None blocking. Every architectural fork (synchronous unpersisted endpoint,
run-all-enabled-agents, behaviour-preserving extraction vs duplication, ephemeral
no-persistence, CLI-as-second-bin, client-side repo match, server-computed
exit-code gate, server-copy-only contract) was decided before planning. The only
implementation-time verify items — the exact `git diff` invocation for the future
`branch` mode, and whether to parallelize agents later — are noted in §5 and do
not block v1.
