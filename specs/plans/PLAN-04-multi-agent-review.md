# Implementation Plan: Multi-Agent Review (SPEC-04)

**Status:** planning
**Scope:** shared contracts (both vendored copies) · `server/` (`@devdigest/api`) · `client/` (`@devdigest/web`)
**Spec:** `specs/SPEC-04-multi-agent-review.md` — the source of truth for WHAT/WHY (46 EARS criteria, AC-1…AC-46, no open clarifications). This document is HOW only; it does **not** re-litigate any requirement.
**Execution mode:** **multi-agent — 4 steps.**

> **Why 4 steps (the 3–5 cap).** The natural fault lines are: (a) the vendored contract + DB-schema foundation that everything else compiles against, (b) the whole server side, (c) the PR-page picker, (d) the Multi-Agent Review page. A finer split (e.g. server repository / server service / server routes, or configure-view / results-view / conflicts-panel) would produce 8–9 steps that all share the same files — so adjacent same-package work is deliberately merged into one larger step each. Step 1 must land first because steps 2–4 all compile against the contracts it adds; **steps 2, 3 and 4 are then fully independent and dispatch in parallel** (disjoint file lists, no cross-step imports). This is the maximum parallel width the feature actually supports.

> **Worktree-A scope boundary (from the spec).** Do **not** touch `ci/`, `agent-runner/`, the Per-Agent Stats feature, the memory curator, the "Compose Review" drawer, or any new trace/live-log UI.

---

## Planner decisions (made here, not questions back to the user)

The spec flags a handful of items as "implementation-planner decision". All are resolved below; the Implementer must follow these, not re-open them.

| # | Question the spec left open | Decision |
|---|---|---|
| D1 | New module vs. inside `modules/reviews/` | **New module `server/src/modules/multi-agent/`** (`constants`/`helpers`/`repository`/`service`/`routes`, one import + one entry in `modules/index.ts`), matching every sibling feature (`brief`, `blast`, `smart-diff`, `intent`, `evals`). `modules/reviews/` is already the largest feature area (7 files + a 3-file repository split); the multi-agent read model is a distinct aggregate. Only **4** `reviews/` files are edited (see step 2) — the run executor, the service, and the two halves of the run-repository write signature. |
| D2 | FK column vs. join table for AC-15 | **Nullable FK column** `agent_runs.multi_agent_run_id → multi_agent_runs.id ON DELETE SET NULL`, one migration. One agent run belongs to at most one group. No join table. |
| D3 | Naming/shape of the new pre-run-estimate contract | **`AgentRunEstimate`** (+ nothing else), added to `contracts/observability.ts` under its own heading, **below** the Multi-Agent block and **above** the reserved Per-Agent-Stats block. Deliberately not `AgentStats`. Shape: `{ agent_id, agent_name, runs_sampled: int, avg_duration_ms: int|null, avg_cost_usd: number|null }` — nullable averages express "no history" (AC-9). |
| D4 | Estimate endpoint | **`GET /multi-agent/estimates`** → `AgentRunEstimate[]`, workspace-scoped, served by the new module. Deliberately **not** `/agents/estimates` — that would sit under `modules/agents`' URL space and shadow-compete with `GET /agents/:id`. |
| D5 | Where the failure reason lives on a failed column (AC-20/AC-23) — `AgentColumn` has **no** `error` field and no field may be added | **`AgentColumn.summary` carries the failure/cancellation reason** for `status: 'failed'` columns (`agent_runs.error`, or `"Cancelled by user"` when the row is `cancelled`). `verdict`/`score` stay `null`. Shape unchanged. |
| D6 | `total_duration_ms` semantics (AC-24 only pins the in-flight case) | While **any** run is `running`: `Date.now() − multi_agent_runs.ran_at`. Once **every** run is terminal: `max(duration_ms)` over the columns (`0` when there are none) — the honest number under parallel fan-out, consistent with AC-10's aggregate and AC-36's header. |
| D7 | `GET /pulls/:id/multi-agent` when the PR has no group yet | `200` with **`null`** (`response: { 200: MultiAgentRun.nullable() }`). Precedent: `GET /pulls/:id/brief` returns `Brief.nullable()`. A 404 would fire the client's global error toast on a perfectly normal empty state. The `MultiAgentRun` shape itself is untouched. |
| D8 | `ConflictTake.note` (required `string`, and AC-31 forbids free-text invention) | `note` = the producing finding's own `title` when the agent flagged the location; **`""`** when the verdict is `'ignored'`. The client renders the localized "did not flag" label from the **verdict**, never from `note` (AC-32) — so zero user-facing copy is produced server-side. |
| D9 | Divergence classification (AC-30) — `Conflict` cannot carry an `is_divergent` flag | The server emits the **widened** set (AC-46) only. Divergence is a **pure client helper** `isDivergent(conflict)` in the results page's `helpers.ts`, driving the "Show only conflicts" filter. Unit-tested client-side (AC-30's verify is "unit"). |
| D10 | Agents whose run is still `running` (spec pins failed/cancelled in AC-29, is silent on running) | Treated **exactly like failed**: excluded from every group's takes. A run still in flight has not "reviewed and chosen not to flag" either. AC-44 renders the panel over the terminal group, so this only affects the transient view. |
| D11 | Does `POST /pulls/:id/review` also gain `agentIds`? | **No.** `RunRequest` gains the field (AC-11) and `ReviewService.resolveTargets` understands it, but only the new `POST /pulls/:id/multi-agent-run` route passes it. `modules/reviews/routes.ts` is **not** in any step's file list — AC-12 ("existing behavior unchanged") is satisfied by literally not touching it. |
| D12 | `RunTraceDrawer` reachability from `/multi-agent` (spec calls this an import/relocation question) | **Import in place, do not relocate, do not copy.** `client/src/app/multi-agent/_components/...` imports the default export from `@/app/repos/[repoId]/pulls/[number]/_components/RunTraceDrawer`. `_components` is a Next.js private folder (never routed) and the drawer has no route-local dependencies (`useRunTrace`, `useRunEvents`, `@devdigest/ui` only). If that bracketed specifier fails to resolve under webpack, fall back to a relative path to the **same physical file** — never a second component (AC-39). |
| D13 | The kick-off response (AC-18) | Constructed **deterministically from the just-created rows** (every column `status:'running'`, `findings: []`, `conflicts: []`, `total_duration_ms: 0`, `total_cost_usd: null`) rather than re-reading the DB. Race-free, trivially unit-testable, and exactly what AC-18 asks for. |

## Simplicity constraints (agreed before planning — do not add infrastructure beyond these)

- **Concurrency = `Promise.allSettled` over the existing `jobs` array.** No job queue, no worker pool, no bounded semaphore, no git-worktree isolation. The diff load stays exactly where it is (once per group, before the fan-out).
- **Grouping = one nullable FK column.** No join table, no group-membership service.
- **Conflicts = computed on every read**, bucket-by-`file` then a sorted overlap sweep. No interval tree, no SQL-side computation, no cache.
- **Estimates = one query**, last 5 completed runs per agent, averaged in JS. No stats table, no background job, no cache invalidation.
- **Results = one route, one fetch hook**, Columns vs Tabs as two render branches over the same object.
- **Picker = local component state** in the existing `RunReviewDropdown`. No global store.
- **Per-run inspection = the existing `RunTraceDrawer`**, imported, not rewritten.

---

## 0. What already exists (do not touch / do not rebuild)

Audited against this tree. `reviewer-core` needs **zero** edits (no prompt/grounding change — spec Non-goals).

| Artifact | Location | State / how this feature uses it |
|---|---|---|
| `MultiAgentRun` / `AgentColumn` / `AgentColumnFinding` / `Conflict` / `ConflictTake` | `*/vendor/shared/contracts/observability.ts:22-86` (both copies) | **Reused verbatim.** No field added, removed or retyped. Only *new sibling* exports may be added to the file. |
| `AgentStats` / `StatPoint` / `CuratorMerge` / `CuratorResult` | same file, `:88-140` | **Reserved for other features — do not touch, do not extend, do not import.** |
| `multi_agent_runs` table `{id, workspace_id, pr_id, ran_at}` | `server/src/db/schema/runs.ts:44-53` | Exists, unused. **Reused as-is** — the only schema change is the FK on `agent_runs` (D2). `pr_id` already cascades on PR delete. |
| `agent_runs` columns `{status, duration_ms, cost_usd, error, score, findings_count, grounding, provider, model, ran_at}` | `schema/runs.ts:8-34` | **The single source for every column header figure** (AC-41) — the same rows the drawer's Stats section reads. |
| `ReviewService.resolveTargets` (`all` → `listEnabled`; else one agent; else 400 `invalid_run_request`) | `modules/reviews/service.ts:46-57` | **Extend point** for `agentIds` (AC-11/AC-13/AC-14). |
| `ReviewService.runReview` — creates one `agent_runs` row per target up front, returns run ids immediately, executes fire-and-forget | `service.ts:103-138` | **Reused**; gains one optional `multiAgentRunId` so the created rows are linked (AC-15). |
| `ReviewRunExecutor.executeRuns` — loads the diff **once**, then a **sequential** `for` loop with per-agent try/catch | `modules/reviews/run-executor.ts:56-136` | Diff load (`:96-106`) **stays as-is** (AC-21 already true). The loop at `:108-135` becomes concurrent (AC-19); the try/catch body is preserved verbatim (AC-20). |
| `createAgentRun` / `completeAgentRun` (impl + class facade — **both** must change together) | `repository/run.repo.ts` + `repository.ts` | `createAgentRun` gains `multiAgentRunId?: string \| null`. Server insights: adding a field to only one half fails `tsc` at the *call site*, not the facade. |
| SSE `GET /runs/:id/events` (replay buffer, then live, ends on done) | `modules/reviews/routes.ts:74-118` | **Reused as-is** (AC-42). No new endpoint, no change. |
| `POST /findings/:id/accept` \| `/dismiss` (only these two are routed) | `routes.ts:20,169-175` | **Reused as-is** (AC-37). No new finding-action endpoints (AC-38 keeps Learn / eval-case as stubs). |
| `GET /pulls/:id/reviews` → `ReviewRecord[]` with full `FindingRecord` (`confidence`, `rationale`, `suggestion`) | `routes.ts:155`; `usePrReviews` in `client/src/lib/hooks/reviews.ts:51` | **The Tabs detail-panel data source** (AC-35). `AgentColumnFinding` is deliberately *not* widened. |
| `RunTraceDrawer` — **default** export, props `{runId, agentName?, prNumber?, findings?, running?, onClose}` | `client/src/app/repos/[repoId]/pulls/[number]/_components/RunTraceDrawer/RunTraceDrawer.tsx:19-107` | **Mounted, not rewritten** (AC-39/AC-40). Its `running` prop already drives the live-log default. |
| `useRunEvents(runIds[])` (parallel SSE) · `usePrRuns` / `usePrActiveRuns` (poll while running) · `useFindingAction` | `client/src/lib/hooks/reviews.ts:28-48,139-216` | **Reused unchanged.** No step owns this file. |
| `activeKeyFor()` already returns `"multi-agent"` for any path containing `/multi-agent` | `client/src/components/app-shell/helpers.ts:28` | Pre-written. The NAV item's `key` must match it **exactly** — see the near-miss warning below. |
| `messages/en/shell.json` → `nav["multi-agent"] = "Multi-Agent Review"` | `client/messages/en/shell.json:26` | Pre-written. `useShellCommands` does a **dynamic** `t(\`nav.${it.key}\`)` — a key mismatch throws `IntlError: MISSING_MESSAGE` on every shell mount. |
| **No NAV entry** for `/multi-agent`, **no page** under `/multi-agent` | `client/src/vendor/ui/nav.ts:21-39` | Genuinely missing — added in step 3 / step 4. |
| `Dropdown` (`@devdigest/ui`) — **closes the panel on every item click**, `DropdownItemDef` has no `checked` | `client/src/vendor/ui/kit/Dropdown.tsx:9-15,86` | **Cannot host a multi-select checklist.** See step 3's popover note. `vendor/ui/*` is off-limits (except `nav.ts`). |
| `Checkbox` (`@devdigest/ui`) — `{checked, onChange, label}`, `role="checkbox"` + `aria-checked`, **no `disabled` prop** | `client/src/vendor/ui/kit/Checkbox.tsx` | Reused for the checklist rows. RTL: `getAllByRole("checkbox")`. |
| `useActiveRepo()` → `{repoId, activeRepo, repos, setRepoId, reposLoaded}` | `client/src/lib/repo-context.tsx` (**not** under `lib/hooks/`) | The established "active repo" mechanism for workspace-level routes — the Configure-run page's PR picker uses it + `usePulls(repoId)`. Do not invent one. |
| i18n namespaces are **auto-discovered** from `client/messages/en/*.json` | `client/src/i18n/request.ts:17-25` | A new `multiAgent.json` needs **zero** shared-file edits. |
| `Agent.description` one-liner | `contracts/knowledge.ts:184-201`; `useAgents()` | The picker's "what this agent tends to find" (AC-7). |
| Vendored `shared` barrels use `export *` | `*/vendor/shared/index.ts` | New contract exports are picked up automatically — **no barrel edit needed**. `client/src/lib/types.ts` however is an explicit allowlist and **does** need the new names. |
| Per-route `config: { rateLimit: {...} }` precedent (10/min) | `modules/reviews/routes.ts:31` | Mirror on the kick-off POST (AC-17). **Behaviorally unobservable under `NODE_ENV=test`** — assert by source read, never by chasing a live 429 (server insights). |

---

## 1. Module breakdown (dependency order: shared → server → client)

### 1A. Shared contracts (VENDORED — hand-edit **both** copies, keep the changed sections byte-identical)

`server/src/vendor/shared/**` covers server **and** `reviewer-core` (which aliases to the server copy). `client/src/vendor/shared/**` is the client's own copy. They are not npm packages.

**Modify** `contracts/platform.ts` (both copies) — extend `RunRequest` (AC-11):
```ts
export const RunRequest = z.object({
  agentId: z.string().optional(),
  all: z.boolean().optional(),
  /** Arbitrary subset (multi-agent). Takes precedence over agentId/all. */
  agentIds: z.array(z.string()).optional(),
});
```
Additive and optional — every existing `{agentId}` / `{all:true}` body still parses identically (AC-12). Nothing else in this file changes.

**Modify** `contracts/observability.ts` (both copies) — add **one** new export, in its own section placed **after** `MultiAgentRun` and **before** the `// Per-agent Stats` divider:
```ts
// ------------------------------------------------------------------
// Pre-run estimates (GET /multi-agent/estimates)
// NOTE: deliberately NOT AgentStats — that name belongs to the
// out-of-scope Per-Agent Stats feature and must stay unimplemented.
// ------------------------------------------------------------------
export const AgentRunEstimate = z.object({
  agent_id: z.string(),
  agent_name: z.string(),
  /** How many completed runs the averages are taken over (0..5). 0 ⇒ no history. */
  runs_sampled: z.number().int(),
  /** null ⇒ no history; the UI renders "—" and excludes it from the aggregate. */
  avg_duration_ms: z.number().int().nullable(),
  avg_cost_usd: z.number().nullable(),
});
export type AgentRunEstimate = z.infer<typeof AgentRunEstimate>;
```
Do **not** modify `AgentColumnFinding`, `AgentColumn`, `ConflictTake`, `Conflict`, `MultiAgentRun`, `AgentStats`, `StatPoint`, `CuratorMerge`, `CuratorResult`.

*(zod skill: the nullable-not-optional choice is deliberate — "no history" is a value the UI must render, not an absent key. `runs_sampled` is the explicit provenance count rather than inferring it from a null.)*

### 1B. Server — schema + migration

**Modify** `server/src/db/schema/runs.ts` — one column + one index on `agentRuns`:
```ts
multiAgentRunId: uuid('multi_agent_run_id').references(() => multiAgentRuns.id, { onDelete: 'set null' }),
```
and convert the `pgTable` call to the two-arg form with the array extras callback (the shape `schema/eval.ts:45` already uses):
```ts
(table) => [index('agent_runs_multi_agent_run_id_idx').on(table.multiAgentRunId)],
```
- Nullable: every pre-existing and every single-agent run has no group (D2).
- `ON DELETE SET NULL`: deleting a group must not delete its runs' history.
- The `() => multiAgentRuns.id` callback is lazy, so referencing a `const` declared **later in the same file** is fine.
- PostgreSQL does **not** auto-index FK columns, and `WHERE multi_agent_run_id = $1` is the read path's only filter — hence the index.

**Generate** the migration: `cd server && pnpm db:generate` then `pnpm db:migrate`. Never hand-write or hand-edit `src/db/migrations/*`.
> **Server insights — do this carefully.** `db:generate` diffs the *entire* schema, and this repo has a history of corrupted snapshot metadata (`0011`/`0012` / `cost_usd`). Isolate first: temporarily revert `runs.ts`, run `db:generate` once and confirm it proposes **nothing**; restore the edit and run it again. If it proposes a change to a column you did not touch, that is stale snapshot metadata — **do not** generate a catch-up migration for it (that exact fix was tried and reverted before); stop and report.

### 1C. Server — new module `server/src/modules/multi-agent/`

Onion check for the whole module: `helpers.ts` is pure (no `drizzle-orm`, no `db/schema`, no `fastify`); `repository.ts` is queries only, zero business logic; `service.ts` depends on the repository + `ReviewService` and never imports drizzle or fastify; `routes.ts` is the only fastify-aware file and never touches `db.*`.

**New `constants.ts`**
```ts
export const ESTIMATE_SAMPLE_SIZE = 5;                    // AC-8
export const SEVERITY_RANK = { CRITICAL: 3, WARNING: 2, SUGGESTION: 1 } as const; // AC-31/AC-34
export const MULTI_AGENT_RATE_LIMIT = { max: 10, timeWindow: '1 minute' } as const; // AC-17
```

**New `helpers.ts`** — pure, hermetically unit-testable, no I/O. This is where every deterministic rule lives.

- `export type GroupAgent = { agent_id: string; agent_name: string; status: 'done' | 'running' | 'failed' }`
- `export type GroupFinding = { agent_id: string; id: string; severity: Severity; title: string; file: string; start_line: number; end_line: number }`
- `export function mapRunStatus(dbStatus: string | null): 'done' | 'running' | 'failed'` — `'done'→'done'`, `'running'→'running'`, `'failed'|'cancelled'|anything-else→'failed'` (AC-23).
- `export function columnSummary(reviewSummary: string | null, dbStatus: string | null, error: string | null): string | null` — returns `reviewSummary` for a healthy run; for `failed` returns `error`, for `cancelled` returns `error ?? 'Cancelled by user'` (D5, AC-20/AC-23).
- `export function sortFindingsBySeverity(f: AgentColumnFinding[]): AgentColumnFinding[]` — `SEVERITY_RANK` desc, then `file`, then `start_line` (AC-34). Stable and deterministic.
- `export function computeConflicts(findings: GroupFinding[], agents: GroupAgent[]): Conflict[]` — **the whole "Where agents disagree" rule** (AC-26…AC-31, AC-46):
  1. `const participants = agents.filter(a => a.status === 'done')` (AC-29 + D10). If `participants.length < 2` → return `[]` (a group of one, or an all-failed group, has no cross-agent location — spec edge cases).
  2. Bucket findings by `file` into a `Map<string, GroupFinding[]>` — **the bound**: everything below is per-file, never across the whole PR.
  3. Per bucket: sort by `(start_line, end_line)`, then sweep-merge into clusters — start a new cluster when `f.start_line > cluster.maxEnd`, otherwise extend `cluster.maxEnd = max(maxEnd, f.end_line)`. This is exactly pairwise `[start_line, end_line]` overlap with transitivity (AC-27), and it deliberately does **not** merge adjacent-but-disjoint ranges (10–12 vs 13–15 — spec edge case).
  4. Per cluster: `flaggers = Map<agent_id, GroupFinding>` keeping each agent's **highest-severity** finding (tie → lowest `start_line`) — one take per agent even when it flagged the location twice (spec edge case).
  5. `takes = participants.map(a => flaggers.has(a.agent_id) ? { agent_id: a.agent_id, persona: a.agent_name, verdict: <its severity>, note: <its title> } : { agent_id: a.agent_id, persona: a.agent_name, verdict: 'ignored', note: '' })` (AC-28, AC-31 `persona` = agent name, D8 `note`). A failed/cancelled/running agent appears in **no** take (AC-29).
  6. Skip the cluster when `takes.length < 2`. Otherwise emit `{ file, line: min(start_line) (AC-31), title: <highest-severity finding's title, tie → lowest start_line> (AC-31), takes }`.
  7. **Emit every** surviving cluster, including full-agreement ones (AC-46). No divergence filtering server-side (D9).
  8. Sort the result by `(file, line)` so the response is deterministic across reads.
  - Zero LLM calls, zero embeddings, nothing persisted (AC-26). Nothing is keyed on model-authored prose — only `file` + line numbers from already-grounded findings (spec Untrusted-inputs).
- `export function averageEstimates(rows: {agent_id, agent_name, duration_ms, cost_usd, ran_at}[], agents: {id,name}[]): AgentRunEstimate[]` (AC-8/AC-9) — group rows by `agent_id` (input already newest-first), take the first `ESTIMATE_SAMPLE_SIZE`, average `duration_ms` (rounded to int) and `cost_usd` over the **non-null** values of that slice; every agent in `agents` gets a row, and an agent with zero sampled runs gets `runs_sampled: 0, avg_duration_ms: null, avg_cost_usd: null` — never a global default, never a fabricated figure (AC-9).
- `export function totalsFor(columns: AgentColumn[], groupRanAt: Date, now: number): { total_duration_ms: number; total_cost_usd: number | null }` (AC-24 + D6) — `total_cost_usd` = sum of non-null `cost_usd`, or `null` when none is known; `total_duration_ms` = `now − groupRanAt` while any column is `running`, else `max(duration_ms ?? 0)`.

**New `repository.ts`** — Drizzle only, workspace-scoped, no business logic.
- `createGroup(workspaceId, prId): Promise<{ id: string; ranAt: Date }>` — one `multi_agent_runs` insert `.returning({ id, ranAt })` (AC-15).
- `latestGroupForPull(workspaceId, prId): Promise<{ id, ranAt } | undefined>` — `WHERE workspace_id = $ws AND pr_id = $pr ORDER BY ran_at DESC LIMIT 1` (AC-22, AC-16 — the workspace predicate is on the query, **never** derived from a bare group id).
- `runsForGroup(groupId)` — `agent_runs LEFT JOIN agents` on `multi_agent_run_id = $groupId`, ordered by `agents.name` for a stable column order. Returns run id, agent id/name, provider, model, status, error, duration_ms, cost_usd, ran_at.
- `reviewsForRuns(runIds: string[])` — `reviews WHERE run_id IN (...)` → `{run_id, verdict, score, summary}` (one review per run in practice; keep the newest per `run_id`).
- `findingsForRuns(runIds: string[])` — **`findings` has no `pr_id`/`run_id` column**: join `findings INNER JOIN reviews ON findings.review_id = reviews.id WHERE reviews.run_id IN (...)`, selecting `reviews.run_id`, `reviews.agent_id` and the finding's `id, severity, category, title, file, start_line, end_line`. Return `[]` immediately for an empty `runIds` (never build an `inArray` on an empty list).
- `recentCompletedRuns(workspaceId)` — **one** query (AC-8): `SELECT agent_id, duration_ms, cost_usd, ran_at FROM agent_runs WHERE workspace_id = $ws AND status = 'done' AND agent_id IS NOT NULL ORDER BY ran_at DESC`; the per-agent "last 5" slice happens in `averageEstimates`. Workspace-wide, any PR, any repo, zero LLM calls.

**New `service.ts`** — `MultiAgentService(container)`; constructor stores `this.repo = new MultiAgentRepository(container.db)`, `this.reviews = new ReviewService(container)`, `this.agents = container.agentsRepo`, `this.reviewRepo = new ReviewRepository(container.db)`. (Sibling-service composition mirrors `BriefService`; storing each as an instance field is what makes the service hermetically testable by post-construction stubbing — server insights.)

- `async start(workspaceId, prId, body: RunRequest, logger?): Promise<MultiAgentRun>` (AC-13…AC-18)
  1. `const pull = await this.reviewRepo.getPull(workspaceId, prId)`; `NotFoundError` if absent (tenancy + 404).
  2. `const targets = await this.reviews.resolveTargets(workspaceId, body)` — throws before any write. **All-or-nothing** (AC-13) and 400 `invalid_run_request` on an empty/absent selection (AC-14).
  3. `const group = await this.repo.createGroup(workspaceId, prId)` — exactly one row (AC-15).
  4. `const { runs } = await this.reviews.runReview(workspaceId, prId, targets, logger, { multiAgentRunId: group.id })` — N `agent_runs` rows, each linked; background execution fired (AC-15, AC-19 happens inside the executor).
  5. `logger?.info({ groupId: group.id, prId, agentIds: targets.map(t => t.id), agentCount: targets.length }, 'multi-agent: group started')` (spec Observability: group id + PR id + selected agent set).
  6. Return the response **built from `targets`/`runs`**, all columns `running`, `findings: []`, `conflicts: []`, `total_duration_ms: 0`, `total_cost_usd: null` (D13, AC-18).
- `async latest(workspaceId, prId): Promise<MultiAgentRun | null>` (AC-22…AC-26, AC-46)
  1. `getPull` guard (404 if the PR is not in this workspace).
  2. `latestGroupForPull` → `null` when there is none (D7).
  3. `runsForGroup` → `reviewsForRuns` → `findingsForRuns`.
  4. Build one `AgentColumn` per run: `status = mapRunStatus(...)`, `summary = columnSummary(...)` (D5), `verdict`/`score` from the run's review (null on failure), `duration_ms`/`cost_usd` **straight from the `agent_runs` row** — the same source the drawer's Stats section reads (AC-41) — and `findings = sortFindingsBySeverity(that run's findings mapped to AgentColumnFinding)`. Findings are grouped by their **run**, so per-finding agent attribution is structural and lossless (AC-25).
  5. `conflicts = computeConflicts(allFindings, columns.map(c => ({agent_id, agent_name, status: c.status})))`.
  6. `totalsFor(columns, group.ranAt, Date.now())` (AC-24 — never blocks on in-flight runs).
  7. `logger?.info({ groupId, prId, agentCount, terminal: <bool>, totalCostUsd })` so a terminal group with `total_cost_usd: null` is distinguishable in logs from one that genuinely cost nothing (spec Observability).
- `async estimates(workspaceId): Promise<AgentRunEstimate[]>` — `averageEstimates(await this.repo.recentCompletedRuns(workspaceId), await this.agents.list(workspaceId))` (AC-8/AC-9). One query, no cache, no LLM.

**New `routes.ts`** — default Fastify plugin, Zod via `fastify-type-provider-zod` (the repo's convention: the schema validates the request **and** serializes the response; never hand-roll `Schema.parse` for a declared body). All three routes are workspace-scoped through `getContext(container, req)`.

| Route | Schema | Notes |
|---|---|---|
| `POST /pulls/:id/multi-agent-run` | `params: IdParams`, `body: RunRequest`, `response: { 200: MultiAgentRun }`, `config: { rateLimit: MULTI_AGENT_RATE_LIMIT }` | Cost-amplifying: one call starts N paid LLM runs (AC-17). Body is validated by the declared Zod schema — never spread `req.body` into a query. |
| `GET /pulls/:id/multi-agent` | `params: IdParams`, `response: { 200: MultiAgentRun.nullable() }` | Latest group only (AC-22, D7). |
| `GET /multi-agent/estimates` | `response: { 200: z.array(AgentRunEstimate) }` | Workspace-wide (D4, AC-8). |

*(security skill, A01/A06/A08: every route derives its workspace from the request context, never from a body/param field; a bare group id is never trusted for tenancy — the group is always fetched with the workspace predicate; the only new abuse vector is cost amplification, bounded by the rate limit + all-or-nothing validation. No new secrets, no new outbound calls, no new write scopes.)*

**Modify** `server/src/modules/index.ts` — one `import multiAgent from './multi-agent/routes.js';` + one `multiAgent,` entry.

### 1D. Server — the four `modules/reviews/` edits

**Modify** `modules/reviews/service.ts`
- `resolveTargets(workspaceId, opts: { agentId?, all?, agentIds? })` — add, **before** the existing branches:
  ```
  if (opts.agentIds && opts.agentIds.length > 0) {
    const ids = [...new Set(opts.agentIds)];                        // duplicate ids ⇒ one selection (spec edge case)
    const found = await Promise.all(ids.map(id => this.agents.getById(workspaceId, id)));
    const missing = ids.filter((_, i) => !found[i]);
    if (missing.length) throw new NotFoundError('Agent not found'); // 4xx, BEFORE any row is created (AC-13)
    return found as AgentRow[];
  }
  ```
  Everything after it is untouched, so `{all:true}` and `{agentId}` behave exactly as today (AC-12) and an empty/absent selection still hits the existing `AppError('invalid_run_request', …, 400)` (AC-14). An `agentIds: []` falls through to that same 400 by construction.
- `runReview(workspaceId, prId, targets, logger?, opts?: { multiAgentRunId?: string })` — pass `multiAgentRunId: opts?.multiAgentRunId ?? null` into `createAgentRun`. Every existing caller omits the new optional argument and is unaffected.

**Modify** `modules/reviews/repository/run.repo.ts` **and** `modules/reviews/repository.ts` (**together** — the write signature is declared twice; changing only one fails `tsc` at the call site, not at the facade): `createAgentRun` values gains `multiAgentRunId?: string | null`, inserted as `multiAgentRunId: values.multiAgentRunId ?? null`.

**Modify** `modules/reviews/run-executor.ts` — the **only** behavioral change, `executeRuns` lines 108-135:
```ts
// Concurrent fan-out: N agents cost ~N× tokens but ~1× wall clock (AC-19).
// allSettled never rejects, so one agent's failure cannot abort a sibling —
// the same per-agent isolation the sequential loop had (AC-20).
await Promise.allSettled(jobs.map(({ agent, runId }) => this.runJob(workspaceId, pull, repo, diff, agent, runId, runLog, logger)));
```
where `runJob` is a small private method holding **verbatim** the body of today's loop (the `agentStart` timestamp, the started/done/failed `logger?.info`/`error` calls, the `RunCancelledError` branch, the `try/catch` that swallows the error because `runOneAgent` already persisted the failure and completed the bus). `runOneAgent` itself is **not** modified.
- Everything above the loop — the shared `RunLogger`, `failAll`, and the single `loadDiff` — stays exactly where it is: one diff load per group, reused by every agent (AC-21).
- No cap, no pool, no chunking: 10 selected agents start 10 concurrent runs (AC-19).
- `runOneAgent` already narrows the logger per run (`parentLog.forRun(runId)`) and `runBus` is keyed by `runId`, so concurrent runs do not interleave each other's events.

### 1E. Client — shared data layer + estimate math

**New** `client/src/lib/hooks/multi-agent.ts` (TanStack Query only — no `fetch` in components; all through `lib/api.ts`):
- `useMultiAgentRun(prId: string | null)` → `useQuery({ queryKey: ["multi-agent", prId], queryFn: () => api.get<MultiAgentRun | null>(\`/pulls/${prId}/multi-agent\`), enabled: !!prId, refetchInterval: (q) => (q.state.data?.columns ?? []).some(c => c.status === "running") ? 4000 : false })` — **the polling fallback that converges to terminal statuses when SSE drops (AC-43) and stops polling once the group is terminal (AC-44)**. TanStack v5's function-form `refetchInterval` (client insights) — not a `useEffect` + `setInterval`.
- `useAgentRunEstimates()` → `useQuery({ queryKey: ["multi-agent-estimates"], queryFn: () => api.get<AgentRunEstimate[]>("/multi-agent/estimates") })`.
- `useStartMultiAgentRun()` → `useMutation({ mutationFn: ({prId, agentIds}) => api.post<MultiAgentRun>(\`/pulls/${prId}/multi-agent-run\`, { agentIds }), onSuccess: (_d, {prId}) => { qc.invalidateQueries({queryKey:["multi-agent", prId]}); qc.invalidateQueries({queryKey:["pr-runs", prId]}); qc.invalidateQueries({queryKey:["pr-active-runs", prId]}); } })` — **exactly one HTTP request carrying all N ids** (AC-4).
- Import the contract types from `@/lib/types` (type-only — keep every `@devdigest/shared` client import type-only; a runtime value import from the vendored barrel is the webpack `extensionAlias` trap in client insights).

**Modify** `client/src/lib/hooks/index.ts` — `export * from "./multi-agent";` (the barrel is **not** auto-populated).

**New** `client/src/lib/multi-agent-estimates.ts` — pure, shared by the picker (step 3) and the Configure-run page (step 4); precedent `lib/blast-stats.ts`:
- `estimateFor(estimates, agentId): AgentRunEstimate | undefined`
- `hasHistory(e?): boolean` → `!!e && e.runs_sampled > 0 && e.avg_duration_ms !== null`
- `aggregateEstimate(estimates, selectedIds): { durationMs: number | null; costUsd: number | null; counted: number }` — **`max` of the durations and `sum` of the costs** over the selected agents that have history; agents without history are excluded entirely; all-without-history → both `null` (AC-10, AC-9). It must never sum durations or take a max of costs.
- `formatDuration(ms: number | null): string` → e.g. `"8.2s"`, `"—"` when null. `formatCost(usd: number | null): string` → `"$0.20"`, `"—"` when null. (Symbols only; every sentence around them goes through next-intl.)

**Modify** `client/src/lib/types.ts` — add `MultiAgentRun, AgentColumn, AgentColumnFinding, Conflict, ConflictTake, AgentRunEstimate` to the `export type { … } from "@devdigest/shared";` allowlist (it is per-name, not per-file). Also add `FindingRecord`/`ReviewRecord` **only if** not already re-exported, so step 4 need not import from the vendored path.

### 1F. Client — PR-page picker (`RunReviewDropdown`, AC-1…AC-4, AC-45)

The component keeps its **name, file location, props and named export**, so `PrDetailHeader.tsx` needs **no edit** (it is not in any step's file list).

- **The vendored `Dropdown` cannot be used.** `DropdownItem`'s `onClick` calls `onClose()` unconditionally and `DropdownItemDef` has no `checked` — every checkbox tick would close the panel. `vendor/ui/*` is off-limits. Build a small local popover **inside the component's own folder**: the existing `Button` as trigger, a `position: relative` wrapper + `position: absolute` panel, one `mousedown` outside-click effect (mirroring `Dropdown.tsx`'s own 12-line implementation), and `@devdigest/ui`'s `Checkbox` for each row. ~60 lines; no new dependency; no vendored file touched.
- State: `const [checked, setChecked] = React.useState<Set<string>>(new Set())` — local component state only, no store, no context (AC-1). Derived values (`count`, `canRun`, the aggregate line) are **computed during render**, never mirrored into extra `useState` (react-best-practices: derive, don't store).
- Rows: one per agent from `useAgents()` (sorted `name.localeCompare` for stable order across refetches — client insights), each showing checkbox + `Icon.Cpu` + name + that agent's estimate via `estimateFor`/`formatDuration`/`formatCost` (AC-1). Ticking a row **never** starts a run (AC-2).
- Primary action `"Run multi-agent review (N)"` where `N = checked.size`; `disabled` when `N === 0`, and the handler early-returns so no request can be issued (AC-3 — never rely on CSS `pointer-events` as a guard; jsdom ignores it, client insights). Accessible name includes the count (`aria-label` via the i18n `runAction` message with `{count}`) per the spec's a11y requirement.
- On activation: **one** `useStartMultiAgentRun().mutateAsync({ prId, agentIds: [...checked] })` (AC-4), then `onRunStart?.()` / `onRunsStarted?.(res.columns.map(c => c.run_id))` to keep the existing PR-page SSE wiring working, then `router.push(\`/multi-agent?pr=${prId}\`)` (AC-45).
- `"Configure agents…"` now navigates to `/multi-agent` (the Configure-run page), not `/agents` (AC-1).
- The old "Run all enabled agents" and per-agent click-to-run items are **removed** (AC-2). Keep the existing merged/closed-PR warning row and the `warnMerged` prop.
- Every string via `useTranslations("prReview")` → `runReview.*` keys.

**Modify** `client/src/vendor/ui/nav.ts` — add to the `WORKSPACE` group:
```ts
{ key: "multi-agent", label: "Multi-Agent Review", icon: "Users", href: "/multi-agent" },
```
> **Exact-string audit is mandatory (AC-5).** `key` must equal `activeKeyFor`'s return value (`"multi-agent"`, `app-shell/helpers.ts:28`) **and** the `nav` message key in `messages/en/shell.json:26`. This codebase has burned a near-miss (`"eval"` vs `"eval-dashboard"`) **three** times — silent highlight failure *and* a runtime `IntlError: MISSING_MESSAGE` from `useShellCommands`' dynamic `t(\`nav.${it.key}\`)`. `href` carries **no** `:repoId` token (this is a workspace-level route).
> **Pick the icon from the registry, not from lucide-react.** `vendor/ui/icons.tsx` is a curated subset and is off-limits to edit — verify the chosen name exists there before writing it (`Users`/`Cpu`/`Sparkles` are candidates; confirm, don't assume).

### 1G. Client — the Multi-Agent Review page (`/multi-agent`, AC-6, AC-7, AC-30, AC-32…AC-44)

**One route, one fetch hook, two render branches.** Thin route entry + colocated `_components` (the `/eval` route is the precedent). Every folder follows the repo's co-location convention (`Component.tsx` / `constants.ts` / `helpers.ts` / `styles.ts` / `index.ts` / `Component.test.tsx`).

```
client/src/app/multi-agent/
  page.tsx                                  ← thin: <MultiAgentReviewPage />
  _components/
    MultiAgentReviewPage/                   ← the only stateful container
      MultiAgentReviewPage.tsx  constants.ts  helpers.ts  helpers.test.ts
      styles.ts  index.ts  MultiAgentReviewPage.test.tsx
      _components/
        ConfigureRun/        ← step 1 PR picker + step 2 agent checklist (AC-6, AC-7)
        ResultsHeader/       ← agent count · duration · cost · parallel-fan-out (AC-36)
        ColumnsView/         ← one column per agent (AC-34)
        TabsView/            ← one tab per agent + finding detail panel (AC-35, AC-37, AC-38)
        DisagreementPanel/   ← "Where agents disagree" + Show only conflicts (AC-30, AC-32, AC-44)
```

- **Routing / mode.** `useSearchParams()`: no `?pr=` → Configure-run view; `?pr=<prId>` → results view for that PR's latest group. `page.tsx` is a Server Component that renders the `"use client"` container (data hooks only run in client components). Wrap the container's `useSearchParams()` usage per Next 15's client-hook rules (a `<Suspense>` boundary in `page.tsx` if the build asks for one).
- **Configure-run view (AC-6, AC-7).** Step 1: repo from `useActiveRepo()`, PR list from `usePulls(repoId)`. While no PR is selected, step 2 renders as a **disabled empty state** and the run action is not offered (AC-6). Once a PR is picked: one row per agent (checkbox, `Icon.Cpu`, name, the agent's existing `description` one-liner, estimate), a **Select all** control, `"Run multi-agent review (N)"`, and beneath it the aggregate line built from `aggregateEstimate` + `formatDuration`/`formatCost` + a parallel-fan-out label (AC-7, AC-10). Selecting a PR sets `?pr=`; starting a run reuses `useStartMultiAgentRun` and stays on the page, which flips to the results view — the same destination the PR-page picker lands on (AC-45).
- **Results view.** One `useMultiAgentRun(prId)` call feeds **everything**; `ResultsHeader`, `ColumnsView`, `TabsView` and `DisagreementPanel` are presentational and receive the group (or the slice they need) as props. A `useState<"columns"|"tabs">` toggle chooses the branch (AC-33) — **the data is fetched once, not per mode**.
- **Columns (AC-34).** One column per `AgentColumn`, header = live status + `duration_ms` + `cost_usd` (straight from the response, i.e. from `agent_runs` — AC-41) + a **View trace** control; findings beneath, already severity-ordered by the server. Status and severity each need a **text or icon cue, not colour alone** (a11y). The columns strip must **reflow or scroll** at narrow widths with 3+ agents rather than clip.
- **Tabs (AC-35).** One tab per agent; selecting a finding opens a detail panel with `Math.round(confidence * 100)`%, the suggested fix, and Accept / Dismiss / Learn / Turn into eval case. `confidence`/`rationale`/`suggestion` are **not** on `AgentColumnFinding` — read them from `usePrReviews(prId)` (existing hook) and match by finding `id`. Do **not** widen the contract.
- **Actions.** Accept/Dismiss → the existing `useFindingAction()` hook → the existing `POST /findings/:id/accept|dismiss` (AC-37). Learn / Turn into eval case are **disabled** with a **programmatically associated** explanation (`aria-describedby` on a visible hint, not a hover-only `title`) and activating them issues no request (AC-38, a11y).
- **Disagreement panel (AC-30, AC-32, AC-44).** Renders `conflicts[]` — one block per location (`file:line` + `title`), one row per take (`persona` + verdict). A take with `verdict === 'ignored'` renders a **localized "did not flag" label derived from the verdict**, never from `note` (AC-32). A "Show only conflicts" toggle filters through the local pure `isDivergent(c)` helper: `takes` contain an `'ignored'` alongside ≥1 severity, **or** ≥2 distinct severities (D9, AC-30). Toggle off ⇒ every group in the widened set (AC-46) is shown. Empty `conflicts[]` ⇒ an explicit empty state, not an error (spec edge case). The panel renders over the completed group; polling has already stopped by then (AC-44).
- **Live status (AC-42).** `useRunEvents(columns.filter(c => c.status === 'running').map(c => c.run_id))` (existing hook, parallel SSE); when its `running` flag falls to `false`, invalidate `["multi-agent", prId]`. Polling (AC-43) is the belt-and-braces path and needs no extra code — it is already in the hook.
- **Trace drawer (AC-39/AC-40).** `const [traceRunId, setTraceRunId] = useState<string|null>(null)`; when set, mount the **existing** `RunTraceDrawer` (default import, D12) with `{ runId, agentName, prNumber, findings: <that run's FindingRecords from usePrReviews>, running: <that column's status === 'running'>, onClose }`. The drawer's own `running` behavior gives the live-log default and the post-completion persisted trace for free (AC-40). **No second sidebar, trace view or log view may be introduced.**
- **Untrusted content.** Finding titles/rationales/suggestions are LLM output about attacker-influenceable input: render as **text only** — no `dangerouslySetInnerHTML`, no finding field used to build a URL, a command, or a request, and no finding field driving navigation or an automatic action (spec Untrusted-inputs, security skill A05).
- **New** `client/messages/en/multiAgent.json` — namespace auto-discovered; no shared-file edit. Keys: `title`, `configure.*` (`step1`, `step2`, `pickPr`, `noPrSelected`, `selectAll`, `runAction` with `{count}`, `aggregate` with `{duration}`/`{cost}`, `parallelFanOut`), `results.*` (`columns`, `tabs`, `agentCount`, `duration`, `cost`, `viewTrace`, `status.running|done|failed`), `detail.*` (`confidence`, `suggestion`, `accept`, `dismiss`, `learn`, `evalCase`, `comingSoon`), `conflicts.*` (`title`, `showOnlyConflicts`, `didNotFlag`, `empty`), `empty.*`, `loading`. **No hardcoded English in any component** — this repo has three recorded instances of that leak.

---

## 2. Dependency changes

- **DB migration: exactly one** — `agent_runs.multi_agent_run_id` + its index (step 1). Generate with `cd server && pnpm db:generate`, apply with `pnpm db:migrate`. **Never hand-edit `src/db/migrations/*`**, and never hand-fix a snapshot by adding a catch-up migration (see the isolation procedure in §1B). `src/db/migrations/0000*` is off-limits (pgvector).
- **Vendored `@devdigest/shared`: hand-mirrored, not npm.** `server/src/vendor/shared/**` covers server **and** `reviewer-core`; `client/src/vendor/shared/**` is a separate copy. The changed sections of `contracts/platform.ts` and `contracts/observability.ts` must be byte-identical in both. `tsx watch` does **not** hot-reload `vendor/shared/**` — restart the server process for manual verification.
- **No new npm packages** in any package.
- **No new env vars, no new secrets, no new outbound calls, no new write scopes.** Zero additional LLM calls: the only model spend is the selected agents' own review runs.
- **No `reviewer-core` change** (spec Non-goals). But `cd reviewer-core && npm install` must have been run once per checkout/worktree or `cd server && pnpm typecheck` fails resolving `openai`/`zod` inside reviewer-core source. `reviewer-core` uses **npm**, not pnpm.
- **No `client/src/lib/feature-models.ts` change** — this feature registers no `FeatureModelId` (it makes no LLM call of its own).

---

## 3. Execution order

Four steps. **File lists are disjoint — no path appears in two steps.** Step 1 must land first; steps 2, 3 and 4 are then mutually independent and dispatch in parallel.

```
        ┌──► Step 2  server (module + concurrency + kick-off + tests)
Step 1 ─┼──► Step 3  client PR-page picker + sidebar nav
        └──► Step 4  client Multi-Agent Review page
```

---

### Step 1 — Foundation: shared contracts, DB schema + migration, client data layer
**Depends on:** nothing.

**Owns:**
- `server/src/vendor/shared/contracts/platform.ts`
- `server/src/vendor/shared/contracts/observability.ts`
- `client/src/vendor/shared/contracts/platform.ts`
- `client/src/vendor/shared/contracts/observability.ts`
- `server/src/db/schema/runs.ts`
- `server/src/db/migrations/**` (the generated `.sql` + `meta/_journal.json` + the new `meta/*_snapshot.json`)
- `client/src/lib/types.ts`
- `client/src/lib/hooks/multi-agent.ts` *(new)*
- `client/src/lib/hooks/index.ts`
- `client/src/lib/multi-agent-estimates.ts` *(new)*
- `client/src/lib/multi-agent-estimates.test.ts` *(new)*

**Done when:** `RunRequest.agentIds` and `AgentRunEstimate` exist byte-identically in both vendored copies; `MultiAgentRun`/`AgentColumn`/`AgentColumnFinding`/`Conflict`/`ConflictTake`/`AgentStats`/`CuratorResult` are provably unchanged (`git diff` shows additions only); the migration is generated **and** applied and `pnpm db:generate` reports zero remaining drift; `cd server && pnpm typecheck` and `cd client && pnpm typecheck && pnpm test` are green; `server/test/contracts.test.ts` still passes (additive contracts, but re-run it — it round-trips hardcoded literals).

**Test criteria (cited by AC id):**
- **AC-11:** `RunRequest.parse({agentIds:['a','b']})` succeeds; `RunRequest.parse({all:true})` and `RunRequest.parse({agentId:'x'})` still succeed unchanged (contract half of AC-12).
- **AC-15:** `agent_runs.multi_agent_run_id` exists, is nullable, references `multi_agent_runs.id` `ON DELETE SET NULL`, and is indexed — the durable linkage that survives restart.
- **AC-9 (client half):** `formatDuration(null) === "—"` and `formatCost(null) === "—"`; an agent with `runs_sampled: 0` is excluded from `aggregateEstimate`.
- **AC-10:** `aggregateEstimate` returns **`max`** of `avg_duration_ms` and **`sum`** of `avg_cost_usd` over the selected agents — explicit assertions that it does *not* sum durations and does *not* max costs; all-selected-without-history ⇒ `{durationMs: null, costUsd: null}`.

---

### Step 2 — Server: `modules/multi-agent/`, concurrent fan-out, kick-off plumbing, tests
**Depends on:** step 1 (contracts + the FK column).

**Owns:**
- `server/src/modules/multi-agent/constants.ts` *(new)*
- `server/src/modules/multi-agent/helpers.ts` *(new)*
- `server/src/modules/multi-agent/repository.ts` *(new)*
- `server/src/modules/multi-agent/service.ts` *(new)*
- `server/src/modules/multi-agent/routes.ts` *(new)*
- `server/src/modules/index.ts`
- `server/src/modules/reviews/service.ts`
- `server/src/modules/reviews/repository.ts`
- `server/src/modules/reviews/repository/run.repo.ts`
- `server/src/modules/reviews/run-executor.ts`
- `server/test/multi-agent.test.ts` *(new — hermetic)*
- `server/test/run-executor.test.ts` *(existing — extend)*
- `server/test/multi-agent.it.test.ts` *(new — real Postgres)*

**Done when:** hermetic suite green (`cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'`); `pnpm typecheck` green; the `.it.test.ts` written and typechecked against the real schema. *(Testcontainers cannot start Postgres in this sandbox — do not debug that error; verify by close reading + the hermetic suite and say so in the summary.)*

**Test criteria (cited by AC id):**
- `multi-agent.test.ts` (pure helpers + service with stubbed repo/`ReviewService`, object-literal-cast + post-construction field overwrite pattern):
  - **AC-8, AC-9 (server half):** `averageEstimates` averages over the last 5 completed runs per agent, over however many exist when fewer than 5, degenerates to the single run when there is one, and returns `runs_sampled: 0` + both averages `null` for an agent with no completed run — never a global default. Zero LLM calls.
  - **AC-23:** `mapRunStatus` — `done→done`, `running→running`, `failed→failed`, `cancelled→failed`; **AC-20/AC-23:** `columnSummary` preserves the failure reason (and `"Cancelled by user"` for a cancelled run).
  - **AC-24:** `totalsFor` — with one column still `running`, `total_duration_ms` is the elapsed-since-group-start and `total_cost_usd` sums only the known costs; with no cost known, `null`; the function never waits on anything.
  - **AC-25:** each column's `findings[]` contains exactly that agent's findings (attribution is structural and lossless).
  - **AC-26:** `computeConflicts` is a pure function of its inputs, makes no call, and returns a value that is never persisted.
  - **AC-27:** two findings from **different** agents in the same file with overlapping `[start_line,end_line]` land in one group; **10–12 vs 13–15 do not group**.
  - **AC-28:** one take per participating agent — its severity when it flagged, `'ignored'` when it completed and did not flag.
  - **AC-29:** an agent whose run is `failed`/`cancelled` (and, per D10, `running`) gets **no** take in **any** group.
  - **AC-31:** group `line` = lowest `start_line`; `title` = the highest-severity finding's title; each take's `persona` = the producing agent's name; output ordering deterministic.
  - **AC-46:** a location where **every** participating agent flagged the **same** severity is still present in `conflicts[]`.
  - **AC-13/AC-14:** `resolveTargets` with an unknown agent id throws a 4xx **before** `createGroup` is called (assert the repo stub's `createGroup` was never invoked, and no run was started); with `{}` / `{agentIds: []}` it throws the existing 400 `invalid_run_request`.
  - **AC-18:** `start()` resolves to a `MultiAgentRun` whose columns are all `running`, with `conflicts: []`, without awaiting any agent.
  - **AC-22:** the composed document parses against the existing `MultiAgentRun` Zod contract (round-trip assertion).
- `run-executor.test.ts` (extend):
  - **AC-19:** with a mock LLM given per-agent delays, three agents complete in ≈ `max(delay)`, not `Σ(delay)`, and an in-flight counter proves all three ran simultaneously; a 10-agent selection starts 10 concurrent runs with no cap.
  - **AC-20:** one agent throwing leaves the other runs completing normally, only that agent's row marked failed with its reason, and `executeRuns` still resolves.
  - **AC-21:** `loadDiff` / `container.git.diff` is invoked **exactly once** for a 3-agent group.
- `multi-agent.it.test.ts` (real Postgres):
  - **AC-15:** one `POST /pulls/:id/multi-agent-run` creates exactly one `multi_agent_runs` row and N `agent_runs` rows all carrying its id; a fresh `GET /pulls/:id/multi-agent` reconstructs the same group (survives a new service instance ⇒ survives restart/reload).
  - **AC-11:** `{agentIds:[a,b,c]}` starts three runs from one request; duplicate ids in `agentIds` produce **one** run per distinct agent.
  - **AC-12:** `POST /pulls/:id/review` with `{agentId}` and with `{all:true}` behaves exactly as before (unchanged responses, no group row created).
  - **AC-13:** a request naming a non-existent / other-workspace agent id returns 4xx and creates **zero** `multi_agent_runs` and **zero** `agent_runs` rows.
  - **AC-16:** a group belonging to another workspace is not readable through either endpoint (the PR guard 404s; the group query carries the workspace predicate).
  - **AC-22, AC-24:** `GET /pulls/:id/multi-agent` returns the **latest** group, parses against the `MultiAgentRun` contract, and returns while a run is still `running` without blocking.
  - **AC-17:** *source-level* assertion that the kick-off route declares `config.rateLimit` at ≥ the existing 10/minute — a route-level rate limit is inert and behaviorally unobservable under `NODE_ENV=test`; do not attempt to trigger a real 429.

---

### Step 3 — Client: PR-page multi-select picker + sidebar nav
**Depends on:** step 1 (contract types, `useAgents`-adjacent hooks, estimate helpers).

**Owns:**
- `client/src/app/repos/[repoId]/pulls/[number]/_components/RunReviewDropdown/RunReviewDropdown.tsx`
- `client/src/app/repos/[repoId]/pulls/[number]/_components/RunReviewDropdown/constants.ts`
- `client/src/app/repos/[repoId]/pulls/[number]/_components/RunReviewDropdown/styles.ts`
- `client/src/app/repos/[repoId]/pulls/[number]/_components/RunReviewDropdown/index.ts`
- `client/src/app/repos/[repoId]/pulls/[number]/_components/RunReviewDropdown/RunReviewDropdown.test.tsx`
- `client/src/vendor/ui/nav.ts`
- `client/src/components/app-shell/helpers.test.ts`
- `client/messages/en/prReview.json`

**Done when:** `cd client && pnpm typecheck && pnpm test` green; `PrDetailHeader.tsx` and `page.tsx` are **not** modified (the component's props/export are unchanged); no `vendor/ui` file other than `nav.ts` is touched.

**Test criteria (cited by AC id):** RTL, mocked `fetch`, static top-level import + `vi.fn().mockReturnValue()` per test (never dynamic `import()` + module-level mutable closures — that pattern is flaky here).
- **AC-1:** opening the dropdown renders one checkbox row per agent with name, icon and that agent's estimate; a primary `"Run multi-agent review (N)"` action; and a `"Configure agents…"` item that navigates to `/multi-agent`.
- **AC-2:** ticking an agent row issues **no** run request and does **not** close the panel; no "Run all enabled agents" or per-agent run item exists any more.
- **AC-3:** with zero checked, the primary action is non-actionable (disabled attribute **and** a handler early-return) and clicking it issues no request — asserted on the mocked fetch, not on CSS.
- **AC-4:** with three checked, activating the action produces **exactly one** `fetch` call to `/pulls/:id/multi-agent-run` whose body carries all three ids — not three calls.
- **AC-45:** after a successful start, `router.push` is called with `/multi-agent?pr=<prId>` (mocked `next/navigation`).
- **AC-9, AC-10 (picker rendering):** an agent with no history shows `—`; the selection's aggregate line shows `max(duration)` / `sum(cost)` with the parallel-fan-out label.
- **AC-5:** in `app-shell/helpers.test.ts` — string-equality assertions that the NAV item's `key`, `activeKeyFor("/multi-agent")`'s return value, and the `nav` key present in `messages/en/shell.json` are **all exactly** `"multi-agent"`, and that the chosen `icon` name exists in the `Icon` registry.
- a11y: the run action's accessible name announces the checked count; status/severity cues are not colour-only.

---

### Step 4 — Client: the Multi-Agent Review page (Configure run + results + disagreement panel)
**Depends on:** step 1 (contract types + `useMultiAgentRun`/`useAgentRunEstimates`/`useStartMultiAgentRun` + estimate helpers).

**Owns:**
- `client/src/app/multi-agent/page.tsx` *(new)*
- `client/src/app/multi-agent/_components/**` *(new — the whole tree in §1G, including every colocated `constants.ts`/`helpers.ts`/`styles.ts`/`index.ts` and the `*.test.tsx` / `helpers.test.ts` files)*
- `client/messages/en/multiAgent.json` *(new)*

**Done when:** `cd client && pnpm typecheck && pnpm test` green; the page mounts the **existing** `RunTraceDrawer` (no new drawer/trace/log component anywhere in the tree); no file outside this list is modified.

**Test criteria (cited by AC id):** RTL with mocked hooks/`fetch`; wrap the tree in the real `<ToastProvider>` if any child calls `useToast()` (or use the module-level `notify` bridge instead).
- **AC-6:** with no PR selected, step 1 (PR picker) renders and step 2 (agent checklist) renders as a disabled empty state; no run action is offered.
- **AC-7:** with a PR selected, one row per agent shows checkbox + icon + name + the agent's `description` + its estimate; a **Select all** control, a `"Run multi-agent review (N)"` action, and an aggregate estimate line beneath it are present.
- **AC-9, AC-10:** the aggregate line renders `—` for a no-history agent, excludes it from the aggregate, and shows `max(duration)` / `sum(cost)` with the parallel-fan-out label.
- **AC-33:** the view-mode toggle switches Columns ⇄ Tabs over the **same** fetched object — assert the data hook is called once, not once per mode.
- **AC-34:** Columns mode renders one column per agent with live status, duration, cost and a **View trace** control, findings ordered CRITICAL → WARNING → SUGGESTION; status and severity each carry a non-colour cue.
- **AC-35:** Tabs mode renders one tab per agent; selecting a finding shows confidence as a percentage of the 0..1 value, the suggested fix, and Accept / Dismiss / Learn / Turn into eval case.
- **AC-36:** the header shows agent count, total duration, total cost and a parallel-fan-out label — and **not** a worktree-isolation claim.
- **AC-37:** Accept and Dismiss call `POST /findings/:id/accept` / `/dismiss` (assert the exact paths on the mocked fetch); no other finding-action path is ever requested.
- **AC-38:** Learn and Turn into eval case render disabled with a programmatically associated "coming soon" explanation; activating them issues **no** request.
- **AC-39:** activating **View trace** (Columns) and the run-detail control (Tabs) mounts the existing `RunTraceDrawer` with that agent's `run_id` — assert the imported component, and assert no second sidebar/trace/log component exists in the tree.
- **AC-40:** a drawer opened for a still-running column receives `running: true` (its existing live-log default); after completion it receives `running: false`. *(End-to-end SSE behavior is the drawer's own, already-covered behavior — verify by prop, plus manual/e2e.)*
- **AC-41:** the duration and cost in a column/tab header come from the run record in the response — assert they equal the same `AgentColumn.duration_ms`/`cost_usd` the drawer's Stats would read; no separately-computed figure.
- **AC-42:** running columns subscribe via `useRunEvents` on their `run_id`s and the group refetches when the stream completes — status flips running → done/failed with no reload.
- **AC-43:** with SSE unavailable/erroring, the polling read path still converges the columns to terminal statuses (assert the `refetchInterval` function returns an interval while any column is `running`).
- **AC-44:** once every column is terminal, the disagreement panel renders over the completed group and `refetchInterval` returns `false` (polling stopped).
- **AC-30:** `isDivergent` unit tests — `'ignored'` + a severity ⇒ divergent; two different severities ⇒ divergent; all-same-severity ⇒ not divergent. With "Show only conflicts" **on**, exactly the divergent groups render (full-agreement groups hidden); **off**, every group in the widened set renders.
- **AC-32:** an `'ignored'` take renders a localized "did not flag" label derived from the **verdict** (assert the message key is used, and that `note` is not rendered as the label).
- Edge cases: empty `conflicts[]` renders an explicit empty state, not an error; a group whose columns are all `failed` still renders with each reason visible; a group of one renders one column and no conflicts.
- Untrusted content: finding text is rendered as text (no `dangerouslySetInnerHTML` anywhere in the tree; no finding field used to build a URL or trigger navigation).

---

### AC coverage map (all 46 accounted for)

| Step | ACs covered by that step's test criteria |
|---|---|
| 1 | AC-9 (client), AC-10, AC-11, AC-15 |
| 2 | AC-8, AC-9 (server), AC-11, AC-12, AC-13, AC-14, AC-15, AC-16, AC-17, AC-18, AC-19, AC-20, AC-21, AC-22, AC-23, AC-24, AC-25, AC-26, AC-27, AC-28, AC-29, AC-31, AC-46 |
| 3 | AC-1, AC-2, AC-3, AC-4, AC-5, AC-9, AC-10, AC-45 |
| 4 | AC-6, AC-7, AC-9, AC-10, AC-30, AC-32, AC-33, AC-34, AC-35, AC-36, AC-37, AC-38, AC-39, AC-40, AC-41, AC-42, AC-43, AC-44 |

Every id AC-1 … AC-46 appears at least once. ACs listed under more than one step are the ones with a genuine server half and client half (AC-9, AC-10, AC-11, AC-15).

---

## 4. Definition of Done (whole feature)

- [ ] **shared:** `git diff` on both vendored `contracts/observability.ts` shows **only** the added `AgentRunEstimate` block — `MultiAgentRun`/`AgentColumn`/`AgentColumnFinding`/`Conflict`/`ConflictTake` byte-identical to before, and `AgentStats`/`StatPoint`/`CuratorMerge`/`CuratorResult` untouched. `RunRequest.agentIds` present and identical in both `contracts/platform.ts`. Diff server-copy vs client-copy to confirm the changed sections match.
- [ ] **server:** `cd server && pnpm typecheck` green; `pnpm exec vitest run --exclude '**/*.it.test.ts'` green; `multi-agent.it.test.ts` written + typechecked (execution blocked by this sandbox's testcontainers limitation — state that in the summary); `pnpm db:generate` reports **zero** drift after the migration is applied.
- [ ] **client:** `cd client && pnpm typecheck && pnpm test` green. No `vendor/ui` file other than `nav.ts` modified. Every user-facing string goes through next-intl.
- [ ] **Manual (needs `./scripts/dev.sh` + `pnpm db:migrate`):**
  - PR page → dropdown shows a checklist with per-agent estimates; ticking rows does not start anything; the action reads "Run multi-agent review (3)"; activating it fires **one** request and lands on `/multi-agent?pr=…`.
  - The Multi-Agent Review sidebar entry exists, highlights on `/multi-agent`, and the command palette opens without an `IntlError` in the console.
  - Three agents on one PR: the three columns flip running → done independently, **wall clock ≈ the slowest agent** while cost ≈ the sum — the US-8 1-vs-3 comparison.
  - Kill one agent's provider key (or use a bad model) → that column alone shows failed with its reason; the others complete; the group stays readable.
  - Reload mid-run → the group is still there (durable linkage) and converges to terminal statuses; kill the API mid-run and restart → the group still reads back.
  - "Where agents disagree" shows agreement groups by default and only divergent ones with the toggle on; an `'ignored'` take reads "did not flag"; a failed agent appears in no take.
  - **View trace** opens the *existing* drawer with Configuration / Stats / Prompt assembly / Tool calls / Raw output / Copy raw output; while running it opens on the live log.
  - Accept/Dismiss work from the page; Learn / Turn into eval case are disabled with an explanation and fire no request.
  - Server log carries the group id, PR id and the selected agent set per group, and per-run start/finish with status, duration, cost, failure reason.
- [ ] **Edge cases:** one agent selected (group of one, no conflicts) · all agents fail (readable group, empty conflicts, possibly `null` cost) · mixed success/failure (no `'ignored'` take for the failed agent) · agent disabled after selection (run proceeds) · run cancelled mid-group (column `failed`, reason preserved, siblings continue) · duplicate ids in `agentIds` (one run per agent) · adjacent-but-disjoint line ranges (not grouped) · two findings from one agent at one location (one take, highest severity) · PR with no findings (empty columns + explicit empty panel state) · second group on the same PR (latest wins, earlier row retained) · PR deleted (group cascades).
- [ ] **AC coverage:** AC-1 … AC-46 each traceable to a step's test criteria in §3 (see the coverage map).

---

## 5. Risks and assumptions

- **Concurrency is deliberately unbounded (AC-19), and that has a real consequence.** N simultaneous provider calls can trip a provider quota that N sequential ones would not. Each affected run fails independently and the rest of the group completes (AC-20). This is an **accepted** trade for the flat-wall-clock guarantee, recorded in the spec's edge cases — do **not** "fix" it by adding a pool or a cap; the route-level rate limit (AC-17) bounds how *often* a group starts, not how *wide* one fans out.
- **Concurrent `markReviewed(pull.id, pull.headSha)`.** Every run in a group writes the same value to the same PR row, now simultaneously instead of serially. Idempotent (identical value), so the only exposure is brief row contention. Flagged, not mitigated; if it ever shows up, the fix is to hoist that write out of `runOneAgent` into `executeRuns` — deliberately **not** done here, to keep `runOneAgent` byte-unchanged.
- **`Promise.allSettled` changes failure *timing*, not failure *handling*.** Today a pre-work failure fails all runs and each agent's failure is persisted inside `runOneAgent`; none of that moves. The one behavioral difference worth watching in review: `executeRuns` now resolves only after the **slowest** job, where before it resolved after the last sequential job — same end state, shorter wall clock.
- **The estimate query is unbounded in row count.** `recentCompletedRuns` scans the workspace's `status='done'` runs newest-first and slices per agent in JS (the agreed "one query" shape). At this product's scale that is fine; if a workspace ever accumulates tens of thousands of runs, the follow-up is a per-agent `LATERAL` limit — **not** a stats table or a cache. A blanket `LIMIT` would silently starve agents whose last run is old, so do not add one.
- **`AgentColumn` has no `error` field, so the failure reason rides in `summary` (D5).** If a future consumer of `AgentColumn.summary` assumes "model-written review summary", this overload will surprise it. The alternative — widening the contract — is explicitly forbidden by the spec.
- **Divergence logic is duplicated by design (D9).** The server can't ship a flag inside `Conflict`, so `isDivergent` exists only client-side. If the rule ever changes, it changes in one file — but nothing enforces that the server's widened set and the client's filter stay conceptually aligned. Documented, accepted.
- **Cross-route component import (D12) has no precedent in this repo.** No existing client file imports across a bracketed route folder. If webpack refuses the specifier, fall back to a relative path to the same file — **do not** relocate the drawer (that would pull `page.tsx` and the drawer's own test into step 4's file list, breaking disjointness) and **never** copy it.
- **The vendored `Dropdown` cannot host the checklist** (it closes on every item click, has no `checked`) and `vendor/ui/*` is off-limits. The local popover in step 3 is a necessary ~60-line addition, not scope creep — but it is the step's biggest unknown; keep it a faithful copy of `Dropdown.tsx`'s own outside-click pattern rather than reaching for a new dependency.
- **NAV key / message key / `activeKeyFor` near-misses have broken this codebase three times** (silent highlight failure, and a runtime `IntlError` from the command palette's dynamic `t(\`nav.${it.key}\`)`). Step 3's AC-5 test exists specifically to make that class of bug impossible to ship.
- **`.it.test.ts` cannot execute in this sandbox** (testcontainers vs. the Rancher/k3s daemon). Write and typecheck it, verify by close reading + the hermetic suite, and say so in the summary — do not debug the container-runtime error as if it were a test failure.
- **`db:generate` snapshot corruption is a known trap here.** Follow the isolation procedure in §1B; if it proposes a change to a column you did not touch, stop and report rather than generating a catch-up migration.
- **Worktree/commit hygiene** (root insights): each Implementer must `git commit` in its own worktree before reporting done (a completed-but-uncommitted worktree merges as "Already up to date"), and self-check `git merge-base --is-ancestor` / `git merge --ff-only` if its branch point predates step 1's integration commit. Steps 2–4 all depend on step 1's contracts being **present in their worktree** — verify `AgentRunEstimate` and `RunRequest.agentIds` resolve before starting.
