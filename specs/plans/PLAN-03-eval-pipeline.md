# Implementation Plan: Eval Pipeline (SPEC-03)

**Status:** planning
**Scope:** shared contracts (both vendored copies) · server (`@devdigest/api`) · client (`@devdigest/web`)
**Spec:** `specs/eval-pipeline.md` (source of truth for WHAT/WHY — do not re-litigate behavior here)
**Execution mode:** `multi-agent` (confirmed by user). See §3 for the four parallel waves. File ownership is disjoint; Wave 1 (Steps 1+5) → Wave 2 (Steps 2+3+6) → Wave 3 (Step 4, solo) → Wave 4 (Steps 7+8+9).
**reviewer-core:** **zero source edits.** The eval module is a *consumer* of `reviewPullRequest`/`ReviewOutcome` (spec §"Internal contract"). Do not touch `reviewer-core/src/**`.

> This document is HOW to build an already-specced feature, file-by-file, in
> dependency order. Every step lists the exact files it owns; no two steps share
> a file. The Implementer executes one step at a time.

---

## 0. What already exists (do not touch / do not rebuild)

The spec's own audit table (§"What already exists") is the ground truth. **Every path and line
range in it was re-verified against the current tree during planning and is still accurate** — do
not re-audit. The table below records only what planning added or corrected on top of it.

| Artifact | Location | State / how it's used here |
|---|---|---|
| `eval_cases` / `eval_runs` tables | `server/src/db/schema/eval.ts:7-20,22-35` | **Reused.** Only two nullable columns added (EXT-1/EXT-2, step 1). No new table. |
| `EvalCase`/`EvalRun`/`EvalPerTrace`/`EvalOwnerKind` | `contracts/knowledge.ts:56-91` (both copies) | **Frozen — read-only.** Do not edit `knowledge.ts` at all in this feature. |
| `EvalCaseInput`/`EvalRunRecord`/`EvalRunResult`/`EvalTrendPoint`/`EvalDashboard` | `contracts/eval-ci.ts:19-89` (both copies) | **Extended in place** (EXT-1/2/3 + NEW-1..6). Never copied/parallel-defined. |
| **Zero existing consumers of ANY Eval contract** | grep across `server/src`, `server/test`, `client/src` | **Planning finding.** EXT-1/EXT-2 add required-but-nullable fields; no fixture anywhere parses `EvalRunRecord`, so there is no repeat of the `BlastRadius.prior_prs` fixture breakage (`server/insights.md`). |
| **The two vendored `shared` copies are ALREADY not byte-identical** | client copy lacks `AgentVersionConfig`/`AgentVersion` (`knowledge.ts`), `AgentManifest` (`eval-ci.ts`), and the whole `review-diff.ts` | **Planning finding — critical.** The mirroring rule is "the NEW eval shapes must be byte-identical in both copies", NOT "make the files identical". Do **not** `cp` a whole file across; hand-edit the eval block only. |
| `UnifiedDiff.raw: string` | `vendor/shared/adapters.ts:185-188` | **Planning finding.** `loadDiff(...).raw` IS the frozen `input_diff` text verbatim — no diff re-serialization code is needed, and `parseUnifiedDiff(input_diff)` round-trips at run time. |
| `runAgentReview(container, opts)` | `modules/reviews/agent-runner.ts:59-133` | **The single resolution path.** Takes `{repoId, diff, agent, taskPrefix, sessionId, prDescription?, intent?, specs?, onEvent?, checkCancelled?, log?}`. PR-shaped fields are all optional. Never reimplement provider/skills/repo-intel resolution. |
| `ReviewOutcome` | `reviewer-core/src/review/run.ts:101-119, 204-215` | `{review:{findings}, grounding, dropped[{finding,reason}], mode, assembly, chunks, tokensIn, tokensOut, costUsd, raw}`. **No `durationMs`** — the eval runner times the call itself. |
| `loadDiff` / `diffFromPrFiles` / `parseUnifiedDiff` | `modules/reviews/diff-loader.ts:12-30,32-43`; `adapters/git/diff-parser.ts` | Reused as-is for case capture + run-time parse. |
| `findingContext(db, findingId)` | `modules/reviews/repository/review.repo.ts:103-117` | finding → review → pull resolution. Already exists; import it. |
| `container.agentsRepo` | `platform/container.ts` | `getById`/`getVersion`/`listVersions`/`linkedSkills`/`skillIdsForAgent`. Cross-cutting repo — reach it via the container, **never** by importing `modules/agents/repository.ts` from `modules/evals/`. |
| `agents.version` + `agent_versions` snapshot-on-config-change | `modules/agents/repository.ts:118-155` | **Fully working.** Promote reuses it; step 5 only closes the skills-blind hole. |
| `snapshotVersion` reads `skillIdsForAgent(row.id)` at snapshot time | `modules/agents/repository.ts:154` | **Ordering constraint for step 5:** skill links must be written BEFORE `snapshotVersion` runs, or the new snapshot records the OLD skill set. |
| Per-route rate limit pattern | `modules/reviews/routes.ts:29` (`config:{rateLimit:{max:10,timeWindow:'1 minute'}}`) | Copy verbatim onto every eval-run trigger. **Unobservable in tests** under `NODE_ENV=test` — assert by source read only (`server/insights.md`). |
| `getContext(container, req)` + `IdParams` | `modules/_shared/context.ts`, `_shared/schemas.ts` | Workspace-scope EVERY eval route. Non-negotiable (spec §Security). |
| Fire-and-forget precedent | `ReviewService.runReview` returns before the LLM work finishes (`server/insights.md`) | The batch trigger mirrors this exactly (AC-12). |
| `client/messages/en/eval.json` | already present, ~50 keys under `dashboard`/`caseEditor`/`evalsTab`/`page` | **Planning finding.** AC-38 is mostly *additive to an existing catalogue*. Only `en` locale exists. |
| `agents.json` → `editor.tabs.evals: "Evals"` | `client/messages/en/agents.json` | **Already present.** Step 8 needs NO `agents.json` edit. |
| `VALID_TABS` already allowlists `"evals"` | `client/src/app/agents/[id]/page.tsx:15` | **Already correct.** Step 8 must NOT edit `page.tsx` — only `AgentEditor/constants.ts` + `AgentEditor.tsx`. |
| `Icon.FlaskConical`, `Icon.BarChart`, `Icon.ArrowUp/ArrowDown`, `Icon.TrendingUp` | `client/src/vendor/ui/icons.tsx:31,76,37,38,77` | All present in the curated registry. Do not add icons (`client/insights.md`). |
| `MetricCard` (label/value/delta/trend/suffix, delta rendered with an Arrow icon), `Sparkline`, `LineChart`, `Modal`, `Checkbox`, `EmptyState`, `Toggle` | `@devdigest/ui` (`vendor/ui/charts`, `vendor/ui/kit`, `vendor/ui/primitives`) | Reuse. `MetricCard`'s arrow icon already satisfies half of the "delta not by colour alone" a11y rule. **No new chart dependency.** |
| `useActiveRepo()` | `client/src/lib/repo-context.tsx` | Exists if a repo id is ever needed client-side; this feature does not need it. |

### Files this feature must NOT touch

`reviewer-core/src/**` · `contracts/knowledge.ts` (either copy) · `server/src/db/migrations/*` by hand · `client/src/vendor/ui/**` **except** none (see AC-36 resolution below — the fix lands in `app-shell/helpers.ts`, NOT in vendored `nav.ts`) · `client/src/app/agents/[id]/page.tsx` · `eval-ci.ts`'s CI/Conformance/Compose/Hook blocks.

---

## Plan-level decisions (things the spec left open that the build cannot)

These are **HOW** decisions. None changes an acceptance criterion. Recorded here so the Implementer
does not re-derive them.

**D1 — AC-18 needs a wire signal.** A stored metric of `1` is indistinguishable from a genuine 100%,
so the UI cannot render the required "not applicable" marker from `EvalBatchSummary` as the spec
lists it. `EvalBatchSummary` gains `recall_na` / `precision_na` / `citation_accuracy_na` booleans
(true ⟺ that metric's denominator was zero). Server sets them; the client renders `—` + the
`notApplicable` message instead of a percentage.

**D2 — AC-34's summary is a CLIENT pure function, not a server string.** `EvalDashboard.alert` is
`z.string().nullable()`; a server-composed English sentence would violate AC-38 (i18n). Resolution:
server sets `alert: null`; the client computes the largest movement from `recent_batches[0]` vs
`[1]` in `client/src/components/eval/helpers.ts::largestMovement()` (pure, deterministic, unit-tested
per AC-34) and renders it through `eval.json`'s `dashboard.movement.*` keys.

**D3 — `actual_output` gets a typed shape (`EvalRunDetail`, NEW-5).** The spec leaves it
`z.unknown()`, but (a) AC-20 requires a readable failure reason in place of an outcome and (b) the
Observability NFR requires the batch aggregate be reconstructible from per-case rows alone. Because
the batch metrics are **micro-averaged** (pooled numerators/denominators — spec §"Match and metric
definitions"), per-row *percentages* are mathematically insufficient to rebuild them. So each run
row stores its raw counts. `EvalRunRecord.actual_output` stays `z.unknown()` (contract unchanged);
`EvalRunDetail` is a separate schema the server writes and the client optionally parses.

**D4 — AC-36 is fixed in `app-shell/helpers.ts`, not vendored `nav.ts`.** Both directions work
(`activeKeyFor` returns `"eval"`, the NAV item's key is `"eval-dashboard"`). Changing `activeKeyFor`
to return `"eval-dashboard"` preserves the NAV entry's label/icon/href *and* keeps the change out of
`vendor/ui/**`. Grep confirms `activeKeyFor`'s only consumer is
`app-shell/hooks/useShellContext.ts:63` and the only `"eval-dashboard"` occurrence is the NAV entry
itself — so this is a genuinely one-line, single-consumer fix.

**D5 — Promote lives in `modules/agents/`, not `modules/evals/`.** `POST /agents/:id/promote-version`
mutates an agent and must go through the existing agent-update path (AC-30). Putting it in the eval
module would make the eval module own agent-write semantics (onion violation: an outer feature module
reaching into another module's aggregate). It is step 5, self-contained, and can land first.

**D6 — `taskPrefix` must be a TRUSTED CONSTANT.** `runAgentReview`'s `taskPrefix` is concatenated into
the prompt's *trusted* task framing (`agent-runner.ts:89`), unlike `prDescription`, which
`assemblePrompt` delimiter-wraps as untrusted. A case's `input_meta.pr_title`/`pr_body` are
author-controlled. Therefore: `taskPrefix` is a fixed English constant in
`modules/evals/constants.ts`; any recorded PR title/body goes through `prDescription` only. This is
the spec's §"Untrusted inputs" item 2 made concrete.

**D7 — Batch-in-flight guard is an in-process module singleton.** `server/AGENTS.md` already documents
the "ONE API instance per DB" assumption (orphan-run reaping relies on it), so a module-scope
`Map<agentId, batchId>` is consistent with existing architecture and is deterministically testable.
A DB-derived guard (rows < cases_total) has a race window and cannot distinguish "in flight" from
"crashed mid-batch".

**D8 — Fastify route ordering: `/eval-batches/compare` vs `/eval-batches/:batchId`.** find-my-way
prefers static segments over parameterised ones, so both can coexist — but declare
`:batchId` as `z.string().uuid()` anyway so a stray `/eval-batches/anything` 422s instead of
falling through, and register the static `compare` route *first* for readability.

---

## 1. Module breakdown (dependency order: shared → server → client)

### 1A. Shared contracts + schema (VENDORED — edit BOTH copies by hand)

**Modify** `contracts/eval-ci.ts` — **BOTH** `server/src/vendor/shared/contracts/eval-ci.ts` and
`client/src/vendor/shared/contracts/eval-ci.ts`. The new eval block must be **byte-identical** in
both. Do **not** attempt to reconcile the files' other pre-existing differences (see §0).

Import-line adjustments per copy:
- Server copy already imports `{ Verdict, Finding }` from `./findings.js` and
  `{ EvalRun, EvalOwnerKind, Conformance, Provider, CiFailOn }` from `./knowledge.js` — add
  `Severity, FindingCategory` to the findings import.
- Client copy imports `{ EvalRun, EvalOwnerKind, Conformance }` from `./knowledge.js` — add
  `Provider` (it exists in the client's `knowledge.ts`; only `AgentVersionConfig`/`AgentVersion` are
  missing there, and nothing here needs them). Add `Severity, FindingCategory` to its findings import.

New/changed shapes, in this order:

```
NEW-1  EvalExpectationKind = z.enum(['must_find','must_not_flag'])
NEW-1  EvalExpectation = z.object({
         kind: EvalExpectationKind.default('must_find'),   // absent ⇒ must_find (spec table)
         file: z.string().min(1),
         start_line: z.number().int(),
         end_line: z.number().int().nullish(),             // absent ⇒ start_line
         severity: Severity.nullish(),                     // informational ONLY (AC-14)
         category: FindingCategory.nullish(),
         title: z.string().nullish(),
       })
NEW-1  EvalExpectations = z.array(EvalExpectation)

NEW-5  EvalRunCounts = z.object({ must_find, matched, actual, noise, dropped })   // all z.number().int()
NEW-5  EvalRunDetail = z.object({                       // the typed shape of actual_output (D3)
         findings: z.array(Finding).default([]),        // KEPT findings only
         counts: EvalRunCounts,
         model: z.string().nullish(),
         error: z.string().nullable().default(null),    // AC-20 failure reason
       })

EXT-1  EvalRunRecord += batch_id: z.string().nullable()
EXT-2  EvalRunRecord += agent_version: z.number().int().nullable()

NEW-2  EvalBatchStatus = z.enum(['running','complete'])
NEW-2  EvalBatchSummary = z.object({
         batch_id, agent_id, agent_name: z.string(),
         agent_version: z.number().int().nullable(),
         ran_at: z.string(),
         cases_total: int, cases_passed: int,
         recall, precision, citation_accuracy: z.number(),
         recall_na, precision_na, citation_accuracy_na: z.boolean(),   // D1 / AC-18
         cost_usd: z.number().nullable(),
         duration_ms: z.number().int(),
         status: EvalBatchStatus,
       })

EXT-3  EvalDashboard += recent_batches: z.array(EvalBatchSummary).default([])

NEW-3  EvalCompare = z.object({
         agent_id, a: EvalBatchSummary, b: EvalBatchSummary,
         delta: z.object({ recall, precision, citation_accuracy: z.number(),
                           cost_usd: z.number().nullable() }),
         system_prompt_a: z.string().nullable(),      // null ⇒ that side's agent_version is null (AC-28)
         system_prompt_b: z.string().nullable(),
         cases_only_in_a: int, cases_only_in_b: int,  // AC-29
       })

NEW-4  EvalAgentRow = z.object({ agent_id, agent_name, provider: Provider, model,
                                 enabled: z.boolean(), cases_total: int,
                                 last_batch: EvalBatchSummary.nullable(),
                                 recall_trend: z.array(z.number()) })
NEW-4  EvalWorkspaceDashboard = z.object({ workspace: EvalDashboard, agents: z.array(EvalAgentRow) })

NEW-6  EvalBatchStart    = z.object({ batch_id: z.string().nullable(), cases_total: int })
NEW-6  EvalBatchStartAll = z.object({ batches: z.array(z.object({ agent_id, batch_id: z.string().nullable(), cases_total: int })) })
```

`EvalCase`, `EvalCaseInput`, `EvalRunResult`, `EvalTrendPoint`, `EvalRun`, `EvalOwnerKind` are
**unchanged**. `EvalTrendPoint` is now per-*batch* (its `pass_rate` only makes sense with EXT-1) —
a semantic change with no schema change.

**Modify** `server/src/db/schema/eval.ts` — `evalRuns` gains:
```
batchId: uuid('batch_id'),                 // nullable — EXT-1
agentVersion: integer('agent_version'),    // nullable — EXT-2
```
plus, per the Performance NFR ("dashboard reads must not scan full run history"):
`index('eval_runs_batch_idx').on(evalRuns.batchId)`, `index('eval_runs_case_ran_idx').on(evalRuns.caseId, evalRuns.ranAt)`,
`index('eval_cases_owner_idx').on(evalCases.ownerKind, evalCases.ownerId)`.
(`import { index } from 'drizzle-orm/pg-core'` and use the table-callback form.)

**Modify** `server/src/platform/errors.ts` — add:
```
export class ConflictError extends AppError {
  constructor(message = 'Conflict', details?: unknown) { super('conflict', message, 409, details); }
}
```
There is no 409 in the taxonomy today; AC-7 and AC-23 both need one.

**Modify** `client/src/lib/types.ts` — extend the `export type { … } from "@devdigest/shared"` block
with `EvalCase, EvalCaseInput, EvalExpectation, EvalRunRecord, EvalRunDetail, EvalBatchSummary,
EvalCompare, EvalDashboard, EvalWorkspaceDashboard, EvalAgentRow, EvalTrendPoint, EvalBatchStart,
EvalBatchStartAll, AgentVersion`.
⚠️ `AgentVersion` does **not exist in the client's vendored `knowledge.ts`** (see §0). Step 6 needs a
version type for Promote. Two options, decide at implementation time and note it in the commit:
either (a) mirror the `AgentVersionConfig` + `AgentVersion` block from the server's
`knowledge.ts:210-234` into the client copy (closes real pre-existing drift, adds
`client/src/vendor/shared/contracts/knowledge.ts` to step 1's file list), or (b) omit `AgentVersion`
from the re-export and have step 6's Promote hook type the `GET /agents/:id/versions` response
structurally. **(a) is preferred** — the drift is a latent bug and this is the one feature that
actually consumes agent versions. This plan assumes (a); `knowledge.ts` (client copy only) is listed
in step 1's file ownership.

### 1B. Server — `modules/evals/` (new module)

Standard `modules/<name>/{repository,service,routes}.ts` layout (`server/AGENTS.md`), split further
because the module has three genuinely separate concerns. Onion layering:
`routes.ts` (adapter) → `*-service.ts` (application) → `repository.ts` (adapter) + `scorer.ts`/
`expectations.ts` (pure domain).

**New** `modules/evals/constants.ts` — domain constants, no imports beyond types:
`EVAL_CASE_TIMEOUT_MS = 120_000` (Performance NFR: bounded per-case timeout);
`TREND_WINDOW_BATCHES = 20` (bounded trend series);
`MAX_RECENT_RUNS = 50`; `MAX_RECENT_BATCHES = 20`;
`EVAL_TASK_PREFIX` — the trusted constant task framing (D6), e.g.
`'Review the following changes. This is a stored regression case; review it exactly as you would a pull request diff.'`;
`evalSessionId(caseId)` helper for `runAgentReview`'s `sessionId`.

**New** `modules/evals/expectations.ts` — pure. `parseExpectations(raw: unknown): EvalExpectation[]`
— `EvalExpectations.safeParse`; on failure throws `ValidationError` whose message names the **first**
invalid entry's index + path (AC-8). Treats `null`/`undefined` as `[]` (edge case 14: `[]` is legal).
Also `normalizedRange(e): [number, number]` (absent `end_line` ⇒ `start_line`; reversed ⇒ swapped).

**New** `modules/evals/scorer.ts` — pure, **zero I/O, zero LLM** (AC-13). Exports:
- `matches(a: {file,start_line,end_line}, e: EvalExpectation): boolean` — `a.file === e.file && max(aStart,eStart) <= min(aEnd,eEnd)`, both ranges normalised. Severity/category/title never consulted (AC-14).
- `scoreCase(expectations, kept: Finding[], droppedCount: number): { counts: EvalRunCounts; pass: boolean; recall: number|null; precision: number|null; citation_accuracy: number|null }` — per-case metrics (`null` where the denominator is 0, so the row column can be honest; the *batch* level substitutes 1 + `_na`). `pass ⟺ matched === |E_find| && noise === 0` (AC-19).
- `aggregateBatch(rows: EvalRunCounts[]): { recall, precision, citation_accuracy, recall_na, precision_na, citation_accuracy_na }` — **micro-averaged**: `Σmatched/Σmust_find`, `(Σactual−Σnoise)/Σactual`, `Σactual/(Σactual+Σdropped)`; zero denominator ⇒ value `1` + `_na: true` (AC-15/16/17/18).

**New** `modules/evals/batch-registry.ts` — module-scope singleton (D7):
`tryAcquire(agentId, batchId): boolean` · `release(agentId)` · `isRunning(agentId): boolean` ·
`runningBatchId(agentId): string | undefined` · `__resetForTests()`.

**New** `modules/evals/repository.ts` — `EvalsRepository` over `container.db`, queries only, no
business logic. `eval_runs` has no workspace column ⇒ every run query joins through `eval_cases`.
- Cases: `listByOwner(workspaceId, ownerKind, ownerId)` · `getCase(workspaceId, id)` ·
  `insertCase(values)` · `updateCase(workspaceId, id, values)` · `deleteCase(workspaceId, id)` ·
  `countByOwner(...)` · `findByFindingId(workspaceId, ownerId, findingId)` (matches on
  `input_meta->>'finding_id'` — use `sql` template with `jsonb ->>`; AC-6).
- Runs: `insertRun(values)` · `runsForBatch(batchId)` · `runsForOwner(workspaceId, ownerId, {batchId?, limit})` ·
  `batchesForOwner(workspaceId, ownerId, limit)` (distinct `batch_id` ordered by `max(ran_at)` desc,
  limited by `MAX_RECENT_BATCHES`/`TREND_WINDOW_BATCHES`) ·
  `recentRunsForWorkspace(workspaceId, limit)` · `caseIdsInBatch(batchId)` (AC-29) ·
  `caseCountsByOwner(workspaceId)` (grouped count for the workspace dashboard).
- Row→DTO mappers live here or in a sibling `helpers.ts`: **`input_diff` null ⇒ `''`** (edge case 15
  — do NOT loosen the contract), `input_files`/`input_meta`/`expected_output` passed through as
  `unknown`, `ran_at.toISOString()`.

**New** `modules/evals/case-service.ts` — application layer.
- `list/get/create/update/delete` — `owner_kind`/`owner_id` **derived from the route path, never
  trusted from the body** (spec API table). `create`/`update` call `parseExpectations` first (AC-8 →
  400 via `ValidationError`… note `ValidationError` maps to **422**; AC-8 says **400**, so throw
  `new AppError('validation_error', msg, 400, details)` explicitly here rather than reusing
  `ValidationError`).
- `createFromFinding(workspaceId, findingId)` (AC-2..7):
  1. `findingContext(container.db, findingId)` → `{finding, review, pull}`; missing ⇒ 404.
  2. `finding.acceptedAt ?? finding.dismissedAt` both null ⇒ **422** naming the missing decision (AC-2).
  3. `review.agentId` null ⇒ **409** naming the missing agent, no row written (AC-7).
  4. `findByFindingId(...)` hit ⇒ return it with **200** (AC-6, idempotent).
  5. Load the repo row, `loadDiff(container, reviewRepo, workspaceId, pull, repoRow)`;
     `input_diff = diff.raw`, `input_files = diff.files.map(({path,additions,deletions}) => …)`.
  6. `input_meta = { finding_id, pr_id, repo_id, pr_number, pr_title, pr_body, decision: 'accepted'|'dismissed', captured_at }`.
  7. `expected_output = [{ kind: accepted ? 'must_find' : 'must_not_flag', file, start_line, end_line, severity, category, title }]` (AC-3/AC-4). Kind is snapshotted — never recomputed later (AC-25).
  8. Insert, return **201**.

**New** `modules/evals/runner.ts` — the execution path. **Must not** insert `reviews`/`findings`/
`agent_runs` rows, and must not publish on `runBus` (spec §"Internal contract").
- `startBatch(workspaceId, agentId): Promise<EvalBatchStart>`
  - agent not in workspace ⇒ 404.
  - `countByOwner === 0` ⇒ return `{ batch_id: null, cases_total: 0 }`, create nothing (AC-21).
  - `batchRegistry.tryAcquire(agentId, batchId)` false ⇒ `ConflictError` 409 (AC-23).
  - `void this.executeBatch(...)` (fire-and-forget, mirrors `ReviewService.runReview`), return
    `{ batch_id, cases_total }` immediately (AC-12).
- `executeBatch` — capture `agentVersion = agent.version` ONCE before the loop (AC-22), then
  **sequentially** (Performance NFR: no fan-out) per case call `runCase`, insert the row as each
  completes, and `batchRegistry.release(agentId)` in a `finally`.
- `runCase(agent, caseRow, batchId, agentVersion)`:
  - `parseUnifiedDiff(input_diff)`; empty/zero-file ⇒ failure row (AC-20).
  - `Promise.race([runAgentReview(container, opts), timeout(EVAL_CASE_TIMEOUT_MS)])` with
    `opts = { repoId: meta.repo_id ?? '', diff, agent, taskPrefix: EVAL_TASK_PREFIX, sessionId: evalSessionId(case.id), ...(meta.pr_body ? { prDescription: meta.pr_body } : {}) }`.
    **No `onEvent`, no `checkCancelled`, no `log`** (an eval run is not an agent_run).
  - Score: `scoreCase(parseExpectations(case.expected_output), outcome.review.findings, outcome.dropped.length)`.
  - Persist: `{caseId, batchId, agentVersion, actualOutput: EvalRunDetail, pass, recall, precision, citationAccuracy, durationMs, costUsd}`.
  - Catch **everything** (provider-resolution failure, structured-parse failure, timeout, empty diff)
    → failure row `{actualOutput:{findings:[],counts:zeroes,error:msg}, pass:false, metrics:null}`, loop continues (AC-20).
- `startAllAgents(workspaceId)` — enabled agents only; per-agent `startBatch`, swallowing the 409 of
  an already-running agent into `{batch_id:null, cases_total:0}` for that row; returns `EvalBatchStartAll`.
- `runSingleCase(workspaceId, caseId)` — a one-case batch (`cases_total: 1`), same path.

**New** `modules/evals/dashboard-service.ts` — read-only aggregation.
- `batchSummary(batchId)` → `EvalBatchSummary`: pool `actual_output.counts` across the batch's rows
  via `aggregateBatch` (D3); `cases_passed = count(pass === true)`; `duration_ms = Σ`;
  `cost_usd = Σ` (null when every row is null); `status = batchRegistry.isRunning(agentId) ? 'running' : 'complete'`.
- `agentDashboard(workspaceId, agentId)` → `EvalDashboard` + `recent_batches` (AC-33): `current` from
  the newest batch, `delta` vs the previous, `trend` as `EvalTrendPoint[]` over the last
  `TREND_WINDOW_BATCHES` (chronological), `recent_runs` case-level newest-first, **`alert: null`** (D2).
- `workspaceDashboard(workspaceId)` → `EvalWorkspaceDashboard` (AC-35): one `EvalAgentRow` per
  **enabled** agent + a workspace-level `EvalDashboard` with `owner_kind`/`owner_id` **null**.
- `compare(workspaceId, batchA, batchB)` → `EvalCompare` (AC-26/28/29): both batches must belong to
  the **same agent** (else 422); order older→newer by `ran_at`; `system_prompt_X` read via
  `container.agentsRepo.getVersion(agentId, agent_version)` → `configJson.system_prompt`, **null when
  `agent_version` is null** (AC-28); `cases_only_in_a/b` from the symmetric difference of
  `caseIdsInBatch` (AC-29).

**New** `modules/evals/routes.ts` — one default Fastify plugin. Zod `params`/`body`/`response` via
`fastify-type-provider-zod` (never hand-roll `Schema.parse`). `getContext` on **every** route.
Rate limit `{max:10, timeWindow:'1 minute'}` on the four cost-amplifying POSTs (marked ⚡).

| Route | Params/Query/Body | Response | AC |
|---|---|---|---|
| `GET /agents/:id/eval-cases` | `IdParams` | `z.array(EvalCase)` | AC-9, AC-10 |
| `POST /agents/:id/eval-cases` | `IdParams` + `EvalCaseInput` | `201 EvalCase` | AC-8, AC-9 |
| `PUT /eval-cases/:id` | `IdParams` + `EvalCaseInput` | `EvalCase` | AC-8, AC-9 |
| `DELETE /eval-cases/:id` | `IdParams` | `{ ok: true }` | AC-9 |
| `POST /findings/:id/eval-case` | `IdParams` | `201`/`200 EvalCase` · 422 · 409 | AC-2..7 |
| ⚡ `POST /eval-cases/:id/run` | `IdParams` | `202 EvalBatchStart` | AC-12 |
| ⚡ `POST /agents/:id/eval-runs` | `IdParams` | `202 EvalBatchStart` | AC-12, AC-21, AC-23 |
| ⚡ `POST /eval-runs` | — | `202 EvalBatchStartAll` | AC-12 |
| `GET /agents/:id/eval-runs` | `IdParams` + `?batch_id=uuid?` | `z.array(EvalRunRecord)` | AC-22 |
| `GET /eval-batches/compare` | `?a=uuid&b=uuid` | `EvalCompare` | AC-26, AC-28, AC-29 |
| `GET /eval-batches/:batchId` | `z.object({batchId:z.string().uuid()})` | `EvalBatchSummary & { runs: EvalRunRecord[] }` | AC-12 (polling) |
| `GET /agents/:id/eval-dashboard` | `IdParams` | `EvalDashboard` (+`recent_batches`) | AC-33 |
| `GET /eval-dashboard` | — | `EvalWorkspaceDashboard` | AC-35 |

Register `compare` **before** `:batchId` (D8).

**Modify** `server/src/modules/index.ts` — one `import evals from './evals/routes.js';` + one `evals,`
entry. Static registration, nothing else.

### 1C. Server — `modules/agents/` (Promote + the AC-32 versioning fix)

Deliberately its own bounded step so it does not get buried in the eval module.

**Modify** `modules/agents/helpers.ts` — extend `ConfigChangePatch` with `skillIds?: string[]` and
extend `isConfigChange`'s `existing` parameter with `skillIds?: string[]`. Add to the boolean:
`(patch.skillIds !== undefined && existing.skillIds !== undefined && !sameOrderedIds(patch.skillIds, existing.skillIds))`,
where `sameOrderedIds` is a small pure local helper (length + element-wise compare — order matters,
since `AgentVersionConfig.skills` is *ordered*). When `skillIds` is absent on either side the
expression is `false`, so **every existing caller keeps byte-identical behaviour** (AC-31 is
preserved for free).

**Modify** `modules/agents/repository.ts` — `update()` accepts `patch.skillIds`. When present:
`const existingSkillIds = await this.skillIdsForAgent(id)` before the `isConfigChange` call; after
the row `UPDATE` and **before** `snapshotVersion(row, nextVersion)`, call `this.setSkills(id, patch.skillIds)`.
The ordering is load-bearing — `snapshotVersion` reads `skillIdsForAgent` itself (`repository.ts:154`),
so writing the links afterwards would snapshot the OLD set (AC-32).

**Modify** `modules/agents/service.ts` — `UpdateAgentInput` gains `skill_ids?: string[]`; `update()`
forwards it as `skillIds`. Add:
```
promoteVersion(workspaceId, agentId, version): Promise<Agent | undefined>
```
— load the agent (404 if absent), `repo.getVersion(agentId, version)` (404 if absent),
`AgentVersionConfig.parse(row.configJson)`, then **one** `this.update(workspaceId, agentId, {...})`
call carrying provider/model/system_prompt/output_schema/strategy/ci_fail_on/repo_intel/skill_ids
(AC-30). Identical config ⇒ `isConfigChange` false ⇒ no bump, no snapshot (AC-31). Skills-only
difference ⇒ now true ⇒ bump + snapshot (AC-32).

**Modify** `modules/agents/routes.ts` — `POST /agents/:id/promote-version`, body
`z.object({ version: z.number().int().positive() })`, response `Agent`, `getContext` guard,
`config:{rateLimit:{max:10,timeWindow:'1 minute'}}` (it is a write that can trigger downstream paid
runs). 404 via `NotFoundError`.

### 1D. Client

**New** `client/src/lib/hooks/evals.ts` — every eval query/mutation, through `lib/api.ts`
(never a bare `fetch` in a component). Query keys: `["eval-cases", agentId]`,
`["eval-dashboard"]`, `["eval-dashboard", agentId]`, `["eval-runs", agentId, batchId ?? null]`,
`["eval-batch", batchId]`, `["eval-compare", a, b]`, `["agent-versions", agentId]`.
Hooks: `useEvalCases` · `useCreateEvalCase` · `useUpdateEvalCase` · `useDeleteEvalCase` ·
`useCreateEvalCaseFromFinding` · `useRunEvalCase` · `useRunAgentEvals` · `useRunAllEvals` ·
`useEvalRuns` · `useEvalBatch` (with `refetchInterval` while `status === 'running'`, for AC-12 polling) ·
`useAgentEvalDashboard` · `useWorkspaceEvalDashboard` · `useEvalCompare` (enabled only when both ids
are set) · `useAgentVersions` · `usePromoteAgentVersion`.
Invalidation: any run mutation invalidates the two dashboards + `eval-runs`; promote invalidates
`["agent", id]`, `["agents"]`, `["agent-versions", id]`.
**Modify** `client/src/lib/hooks/index.ts` — add `export * from "./evals";` (the barrel is NOT
auto-populated — `client/insights.md`).

**New** `client/src/components/eval/` — cross-route shared presentation, co-located per the repo's
component convention (`Component.tsx` / `constants.ts` / `helpers.ts` / `styles.ts` / `index.ts`):
- `helpers.ts` — pure: `formatMetric(value, na)` → `"—"` when `na` else `"92%"` (AC-18);
  `signedDelta(d)`; `largestMovement(current, previous)` → `{ metric, direction, delta } | null` (D2, AC-34);
  `metricNa(summary, key)`.
- `MetricStrip.tsx` — three `MetricCard`s (recall/precision/citation) with value + delta + optional
  `trend`; renders the "not applicable" marker instead of a percentage when the `_na` flag is set (AC-18).
- `DeltaChip.tsx` — up/down/flat chip with an **explicit textual sign or icon**, never colour alone
  (Accessibility NFR).
- `index.ts` — public API (`MetricStrip`, `DeltaChip`, and the helpers steps 8/9 need).

**Modify** `client/src/components/app-shell/helpers.ts` — `activeKeyFor`'s `/eval` branch returns
`"eval-dashboard"` (D4, AC-36).

**Modify** `client/messages/en/eval.json` — step 6 adds **every** new key needed by steps 6/7/8/9 in
one pass (the file is single-owner; steps 8 and 9 must not edit it). New blocks:
`common.notApplicable` · `dashboard.movement.{recall,precision,citation}.{up,down}` ·
`workspace.*` (title, columns, runAllAgents, runAllConfirm with a total case count, empty state) ·
`compare.*` (title, older/newer, promote, promoteDisabled, versionNotRecorded, caseSetDiffers,
selectTwo, maxTwoSelected) · `batch.*` (running, complete, casesQueued, alreadyRunning) ·
`caseEditor.*` additions (expectation skeleton, validation error, runOnSave, delete confirm) ·
`evalsTab.*` additions (runAll, runAllConfirm, failureReason, expectedGot).
Existing keys are reused as-is — do not rename them.

**Modify** `client/messages/en/prReview.json` (step 7 only) — `finding.turnIntoEvalCase`,
`finding.evalCaseCreated`, `finding.evalCaseExists`.

**Modify** `client/.../FindingCard/FindingCard.tsx` — a third `Button` in the existing `s.actions`
row (`kind="ghost"`, `size="sm"`, `icon="FlaskConical"`), rendered **only** when
`accepted || dismissed` (AC-1/AC-2). It calls `useCreateEvalCaseFromFinding()` directly rather than
threading a prop through `FindingsPanel` → `ReviewRunAccordion` → `FindingsTab` → `page.tsx` — the
same "sibling components each call their own hook" pattern already used by
`PrBriefCard`/`RiskAreasCard`/`ReviewFocusSection` (`client/insights.md` 2026-07-16). Keeps the step's
file list to one component + its test + one message file.

**Modify** `client/.../AgentEditor/constants.ts` — append
`{ key: "evals", labelKey: "editor.tabs.evals", icon: "FlaskConical" }` to `TABS`.
**Modify** `client/.../AgentEditor/AgentEditor.tsx` — add `{tab === "evals" && <EvalsTab agent={agent} />}`.
**Both** are required; a key in one and not the other is dead on arrival (`client/insights.md`; AC-37).
`page.tsx`'s `VALID_TABS` already contains `"evals"` — **do not edit it**.

**New** `client/.../AgentEditor/_components/EvalsTab/` — `EvalsTab.tsx` (metric strip via
`MetricStrip`, case list with name / `expected N / got M` / pass-fail icon / severity+category tags
derived from `expected_output` / per-row Run·Edit·Delete, "Run all evals" with the case count stated
in the confirm (edge case 16), "+ New eval case", empty state per AC-21), `CaseEditorModal.tsx`
(`Modal` from `@devdigest/ui`; Name; Diff/Files/PR-meta views; `expected_output` JSON editor with a
validity indicator and "+ Finding skeleton" insert; last-run status strip; "Run on save" `Toggle`;
Cancel / Run case / Save), plus `constants.ts`/`helpers.ts`/`styles.ts`/`index.ts`.
All user text rendered as **text, not markup** (spec §Untrusted inputs 3/4/5).

**New** `client/src/app/eval/page.tsx` + `_components/WorkspaceEvalDashboard/` — one row per enabled
agent (name, model, last batch `vN · date · X/Y pass`, recall `Sparkline`, the three metrics),
"Run all agents" stating the **total** case count before confirming, and below it the flat
newest-first cross-agent run list from `workspace.recent_runs` (AC-35). Sort the agent list
client-side by name for refetch stability (`client/insights.md`).

**New** `client/src/app/eval/[agentId]/page.tsx` + `_components/AgentEvalDashboard/` — breadcrumb,
the one-line movement summary from `largestMovement()` (AC-34), `MetricStrip` with mini-trends,
a multi-series `LineChart` (numeric values always present alongside — Accessibility NFR), the batch
history table with **max-2** keyboard-operable `Checkbox` selection (third selection prevented;
Compare disabled below two, with the reason exposed to AT via `aria-describedby`/`title`, not colour —
AC-27), and "Run eval".
**New** `_components/CompareModal/` — four `old → new` stat deltas (recall/precision/citation/cost),
the two versions' system-prompt diff, `cases_only_in_*` counts (AC-29), a "version not recorded"
note with Promote disabled on that side (AC-28), and "Promote v<newer>" wired to
`usePromoteAgentVersion` (AC-30).

---

## 2. Dependency changes

- **New packages:** **none.** `Sparkline`/`LineChart`/`MetricCard`/`Modal`/`Checkbox` all already
  exist in `@devdigest/ui`; no new chart or diff library.
- **DB migration:** one, for EXT-1/EXT-2 + three indexes. Generated, never hand-written:
  1. Edit `server/src/db/schema/eval.ts`.
  2. **Isolation check first** (`server/insights.md`): temporarily move the edited file aside, run
     `cd server && pnpm db:generate` once to see what the generator proposes *on its own*, restore
     the file, then generate again. If it proposes a change to a column you believe already exists,
     it is stale snapshot metadata (the `0011`/`0012`/`cost_usd` incident) — **do not** generate a
     catch-up migration for it; stop and report.
  3. `pnpm db:generate` → `pnpm db:migrate`. Never hand-edit `src/db/migrations/*` (including
     `meta/_journal.json` and the snapshots) except for the documented snapshot-repair case above.
- **Env vars:** none. No new secret handling — providers resolve through the existing container and
  keys stay in `~/.devdigest/secrets.json`/env; nothing goes into `eval_cases`, `eval_runs`, or any
  response body (spec §Security).
- **Vendored `@devdigest/shared`:** `contracts/eval-ci.ts` in **both** copies (byte-identical eval
  block), plus `contracts/knowledge.ts` in the **client** copy only (backfilling
  `AgentVersionConfig`/`AgentVersion` — see §1A). Both are step 1's exclusive ownership, so the two
  copies can never land apart.
- **`pnpm verify:l06`** already exists at `package.json:5`. Do **not** create or modify it.
- **Seed:** no change. Eval cases come only from user decisions or hand-authoring (spec Non-goals:
  no auto-generated cases).

---

## 3. Execution order

**File lists are disjoint across every step.** Under `multi-agent`, all steps in a wave may be
dispatched to parallel Implementers; under `single-agent`, work S1→S9 in the listed order.
Parallel safety comes from these lists, not from worktree isolation (root `insights.md`).

---

### Wave 1

#### Step 1 — Shared contracts + DB schema + migration
**Depends on:** nothing.
**Owns:**
- `server/src/vendor/shared/contracts/eval-ci.ts`
- `client/src/vendor/shared/contracts/eval-ci.ts`
- `client/src/vendor/shared/contracts/knowledge.ts`
- `server/src/db/schema/eval.ts`
- `server/src/db/migrations/**` (generated only)
- `server/src/platform/errors.ts`
- `client/src/lib/types.ts`

**Test criteria:** `cd server && pnpm typecheck` and `cd client && pnpm typecheck` clean.
`pnpm db:generate` proposes **exactly** the two nullable columns + three indexes and nothing else
(isolation check per §2). Hand-verify the new eval block is byte-identical in both `eval-ci.ts`
copies (`diff <(sed -n '<range>p' server/...) <(sed -n '<range>p' client/...)`).
**AC coverage:** enables EXT-1/EXT-2/EXT-3, NEW-1..6; directly satisfies the storage half of AC-22.

#### Step 5 — Agents: `isConfigChange` skills fix + Promote
**Depends on:** nothing (fully independent of the eval module — can land first).
**Owns:**
- `server/src/modules/agents/helpers.ts`
- `server/src/modules/agents/repository.ts`
- `server/src/modules/agents/service.ts`
- `server/src/modules/agents/routes.ts`
- `server/test/agents-promote.it.test.ts` (new)
- `server/test/agents-config-change.test.ts` (new, hermetic — pure `isConfigChange` table tests)

**Test criteria:**
- Hermetic: `isConfigChange` returns `false` when `skillIds` is absent on either side (regression
  guard: every existing caller unchanged); `true` for a reordered skill list; `false` for an
  identical one.
- Integration: promote v6 while live is v7 → live config equals v6's snapshot **and** a v8 snapshot
  exists whose config equals v6's (**AC-30**); promote the live version → `agents.version` unchanged,
  no new `agent_versions` row (**AC-31**); promote a version differing only in linked skills → new
  snapshot recorded whose `skills` array is the restored set (**AC-32**).
- Source-read assertion that `POST /agents/:id/promote-version` declares `rateLimit`.
**AC coverage:** AC-30, AC-31, AC-32.

---

### Wave 2 (all three depend only on Step 1)

#### Step 2 — Pure scoring domain
**Depends on:** Step 1.
**Owns:**
- `server/src/modules/evals/constants.ts`
- `server/src/modules/evals/expectations.ts`
- `server/src/modules/evals/scorer.ts`
- `server/test/eval-scorer.test.ts` (new, hermetic)
- `server/test/eval-expectations.test.ts` (new, hermetic)

**Test criteria (all hermetic, zero DB, zero provider):**
- Table-driven `matches`: adjacent-but-not-overlapping ⇒ false; touching by exactly one line ⇒ true;
  reversed ranges normalised; same line different file ⇒ false; differing severity/category/title
  with identical file+range ⇒ still true (**AC-14**).
- `aggregateBatch` recall over a fixture batch with known matches (**AC-15**); an unrelated finding
  elsewhere in the same diff leaves precision unaffected (**AC-16**); 3 kept / 1 dropped ⇒ 0.75
  (**AC-17**); zero denominator ⇒ value `1` **and** `_na: true` (**AC-18**); `pass` ⟺ all `must_find`
  matched ∧ zero noise (**AC-19**); a case with no `must_find` contributes to neither recall
  numerator nor denominator (edge case 3); `[]` expectations are legal and contribute to precision +
  citation only (edge case 14).
- `parseExpectations` rejects a malformed entry with a message naming the first invalid index
  (**AC-8**, unit half); accepts an entry with no `kind` and defaults it to `must_find`; accepts a
  missing `end_line` and treats it as `start_line`.
- Static assertion that neither file imports anything from `adapters/`, `db/`, or a provider
  (**AC-13**, purity half).

#### Step 3 — Eval repository
**Depends on:** Step 1.
**Owns:**
- `server/src/modules/evals/repository.ts`
- `server/src/modules/evals/helpers.ts` (row→DTO mappers)
- `server/test/evals-repository.it.test.ts` (new, real Postgres — the `.it.test.ts` suffix is
  mandatory or the unit/integration split breaks)

**Test criteria:** insert/list/update/delete round-trip, workspace-scoped (another workspace's case
is invisible); seed 8+ cases for one agent, `listByOwner` returns all 8+ with no pagination
(**AC-10**); deleting a case removes its `eval_runs` rows via the existing FK cascade (**AC-9**);
`findByFindingId` matches on `input_meta->>'finding_id'`; a row with a **null** `input_diff` maps to
`""`, never `null` (edge case 15); `batchesForOwner` respects its limit.
> ⚠️ `.it.test.ts` files cannot execute in this sandbox (testcontainers can't reach the Docker
> strategy — `server/insights.md`). Write and typecheck them; verify logic by close reading; note
> in the summary that they were not executed.

#### Step 6 — Client foundation: hooks, shared eval components, nav fix, i18n
**Depends on:** Step 1 (types). Route paths are fixed by §1B/§1C, so no compile dependency on Steps 4/5.
**Owns:**
- `client/src/lib/hooks/evals.ts` (new)
- `client/src/lib/hooks/index.ts`
- `client/src/components/eval/**` (new folder: `MetricStrip.tsx`, `DeltaChip.tsx`, `helpers.ts`,
  `constants.ts`, `styles.ts`, `index.ts`, `helpers.test.ts`, `MetricStrip.test.tsx`)
- `client/src/components/app-shell/helpers.ts`
- `client/src/components/app-shell/helpers.test.ts` (new)
- `client/messages/en/eval.json`

**Test criteria:**
- `activeKeyFor("/eval")` and `activeKeyFor("/eval/<uuid>")` both return `"eval-dashboard"`, matching
  the NAV entry's key so the sidebar item highlights (**AC-36**).
- `MetricStrip` renders the "not applicable" marker (not a percentage) when a `_na` flag is set, and
  a percentage when it is not (**AC-18**, component half).
- `largestMovement` is a pure function: same two batches ⇒ same result; returns `null` when nothing
  moved; picks the single largest absolute movement and its direction (**AC-34**).
- Every string in the new components resolves through `useTranslations` — assert against message
  **keys**, no hard-coded copy (**AC-38**).
- `cd client && pnpm typecheck && pnpm test` clean.

---

### Wave 3

#### Step 4 — Eval services, routes, module registration
**Depends on:** Steps 1, 2, 3.
**Owns:**
- `server/src/modules/evals/batch-registry.ts`
- `server/src/modules/evals/case-service.ts`
- `server/src/modules/evals/runner.ts`
- `server/src/modules/evals/dashboard-service.ts`
- `server/src/modules/evals/routes.ts`
- `server/src/modules/index.ts`
- `server/test/eval-runner.test.ts` (new, hermetic — injected provider double)
- `server/test/evals-cases.it.test.ts` (new, real Postgres)
- `server/test/evals-runs.it.test.ts` (new, real Postgres)

**Test criteria:**
- **Hermetic (`eval-runner.test.ts`)** — build the container as a plain object literal cast
  `as unknown as Container` (`ContainerOverrides` does **not** cover `agentsRepo` —
  `server/insights.md`): run a batch of N cases against a `MockLLMProvider` and assert **exactly N**
  `completeStructured` calls, none originating from the scoring path (**AC-13**). Assert the
  assembled prompt carries the agent's current `system_prompt` and its enabled linked-skill bodies,
  and that no second resolution mechanism exists — the runner's only route to the engine is
  `runAgentReview` (**AC-11**). Assert `taskPrefix` is the module constant and that a PR title/body
  reaches the prompt via `prDescription` (delimiter-wrapped), never via the task line (**D6**).
  Assert the runner never calls `insertReview`/`insertFindings`/`completeAgentRun`/`runBus.*`.
- **Integration (`evals-cases.it.test.ts`)** — undecided finding ⇒ **422** naming the missing decision
  (**AC-2**); accepted ⇒ one `must_find` expectation with file/start_line/end_line copied verbatim,
  no modal, no extra input (**AC-3**); dismissed ⇒ identical but `must_not_flag` (**AC-4**);
  `input_diff`/`input_files`/`input_meta` persisted with `finding_id`, `pr_id` and the decision
  (**AC-5**); two POSTs ⇒ one row, same id both times (**AC-6**); `reviews.agent_id` null ⇒ **409**,
  zero rows written (**AC-7**); invalid `expected_output` ⇒ **400** naming the first invalid entry
  with the stored row unchanged (**AC-8**, route half); CRUD + cascade (**AC-9**); 8+ cases all
  returned (**AC-10**); accept → create case → dismiss the finding ⇒ case still `must_find`
  (**AC-25**).
- **Integration (`evals-runs.it.test.ts`)** — POST returns before all cases finish and rows appear
  incrementally (**AC-12**); one deliberately-corrupt case among three ⇒ three rows, the corrupt one
  carrying a readable failure reason with metrics unset and `pass` false, batch completes (**AC-20**);
  agent with zero cases ⇒ success with `cases_total: 0` and a **null** batch, no rows (**AC-21**);
  every row of a batch carries the same non-null `batch_id` and `agent_version` (**AC-22**); a second
  batch for the same agent while one is in flight ⇒ **409** (**AC-23**); mutate the source PR's
  `pr_files`, re-run the case, assert the prompt still carries the original diff text (**AC-24**);
  compare two batches ⇒ old/new/signed delta for all four metrics plus both versions' system prompts
  (**AC-26**); a batch with a null `agent_version` ⇒ deltas still returned, `system_prompt_*` null
  (**AC-28**); differing case sets ⇒ correct `cases_only_in_a`/`cases_only_in_b` (**AC-29**);
  `GET /agents/:id/eval-dashboard` returns current + delta + trend + pass/total + `recent_batches`
  (**AC-33**); `GET /eval-dashboard` returns one row per enabled agent plus the flat cross-agent run
  list (**AC-35**).
- Source-read assertion that all four ⚡ routes declare `rateLimit` and that every route calls
  `getContext`.
- `cd server && pnpm typecheck && pnpm exec vitest run --exclude '**/*.it.test.ts'` clean.

---

### Wave 4 (all three depend only on Step 6; mutually disjoint)

#### Step 7 — FindingCard "Turn into eval case"
**Depends on:** Step 6 (hook). Runtime-depends on Step 4's route.
**Owns:**
- `client/src/app/repos/[repoId]/pulls/[number]/_components/FindingCard/FindingCard.tsx`
- `client/src/app/repos/[repoId]/pulls/[number]/_components/FindingCard/FindingCard.test.tsx` (new)
- `client/messages/en/prReview.json`

**Test criteria:** component fixtures for accepted / dismissed / undecided — the action renders for
the first two (**AC-1**) and is absent for the third (**AC-2**, component half). The button's label
comes from a message key, not a literal (**AC-38**). Mock the hook with a static top-level import +
`vi.fn().mockReturnValue(...)` reset in `afterEach` — **not** a module-level mutable `let` +
`await import()` inside each `it()`, which is flaky here (`client/insights.md`).

#### Step 8 — Agent editor Evals tab + case editor modal
**Depends on:** Step 6.
**Owns:**
- `client/src/app/agents/[id]/_components/AgentEditor/constants.ts`
- `client/src/app/agents/[id]/_components/AgentEditor/AgentEditor.tsx`
- `client/src/app/agents/[id]/_components/AgentEditor/_components/EvalsTab/**` (new folder + tests)

**Test criteria:** opening the editor with `?tab=evals` renders the Evals tab and keeps it selected
across re-renders (**AC-37** — this is the guard for the documented "key in one allowlist but not the
other" failure mode; `page.tsx`'s `VALID_TABS` already contains `"evals"`, so the test passes only if
**both** `TABS` and the render branch were updated). Zero cases ⇒ empty state inviting case creation,
not an error (**AC-21**, component half). "Run all evals" states the case count before confirming
(edge case 16). Case rows render expected/got counts and a failure reason when the last run failed.
All strings via message keys (**AC-38**).

#### Step 9 — `/eval` workspace + `/eval/[agentId]` per-agent dashboards + Compare
**Depends on:** Step 6. Runtime-depends on Steps 4 and 5.
**Owns:**
- `client/src/app/eval/page.tsx` + `client/src/app/eval/_components/**` (new)
- `client/src/app/eval/[agentId]/page.tsx` + `client/src/app/eval/[agentId]/_components/**` (new,
  including `CompareModal/`)
- co-located tests under those folders

**Test criteria:** selecting two batches enables Compare; attempting a third is prevented; Compare is
disabled below two and exposes *why* to assistive technology, not just visually (**AC-27**). A batch
with no recorded agent version renders the numeric deltas, omits the prompt diff with an explicit
"version not recorded" note, and disables Promote on that side (**AC-28**, component half). The
per-agent dashboard renders current metrics + deltas + trend + pass/total + batch history
(**AC-33**, component half) and the one-line movement summary (**AC-34**, render half). The workspace
dashboard renders one row per enabled agent + the flat cross-agent run list (**AC-35**, component
half). "Run all agents" states the total case count before confirming (edge case 16). Metric deltas
carry a textual sign or icon, never colour alone; the trend chart is never the only presentation of a
metric (Accessibility NFR). All strings via message keys (**AC-38**).

---

### AC → step traceability (all 40)

| AC | Step(s) | AC | Step(s) |
|---|---|---|---|
| AC-1 | 7 | AC-21 | 4 (route) · 8 (empty state) |
| AC-2 | 4 (422) · 7 (component) | AC-22 | 1 (columns) · 4 (write) |
| AC-3 | 4 | AC-23 | 4 |
| AC-4 | 4 | AC-24 | 4 |
| AC-5 | 4 | AC-25 | 4 |
| AC-6 | 3 (lookup) · 4 (idempotency) | AC-26 | 4 |
| AC-7 | 4 | AC-27 | 9 |
| AC-8 | 2 (parse) · 4 (400) | AC-28 | 4 (server) · 9 (component) |
| AC-9 | 3 (cascade) · 4 (CRUD) | AC-29 | 4 |
| AC-10 | 3 · 4 | AC-30 | 5 |
| AC-11 | 4 | AC-31 | 5 |
| AC-12 | 4 | AC-32 | 5 |
| AC-13 | 2 (purity) · 4 (N calls) | AC-33 | 4 (server) · 9 (component) |
| AC-14 | 2 | AC-34 | 6 (pure fn) · 9 (render) |
| AC-15 | 2 | AC-35 | 4 (server) · 9 (component) |
| AC-16 | 2 | AC-36 | 6 |
| AC-17 | 2 | AC-37 | 8 |
| AC-18 | 2 (scorer) · 6 (marker) | AC-38 | 6 · 7 · 8 · 9 |
| AC-19 | 2 | AC-39 | DoD |
| AC-20 | 4 | AC-40 | DoD (manual) |

---

## 4. Definition of Done (whole feature)

**Automated gate**
- [ ] `cd reviewer-core && pnpm typecheck && pnpm test` — must be untouched and green (zero source edits).
- [ ] `cd server && pnpm typecheck`
- [ ] `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'` — hermetic suite green, including the new scorer/expectations/runner tests.
- [ ] `cd client && pnpm typecheck && pnpm test`
- [ ] **`pnpm verify:l06` green from the repo root** (**AC-39**) — this is the single gate; do not modify the script.
- [ ] `cd server && pnpm db:generate` reports **zero** drift after the migration is applied (schema and migrations agree).
- [ ] `.it.test.ts` files: written, typechecked, and reported as *not executed* if testcontainers is unavailable in this environment (`server/insights.md`).

**Contract integrity**
- [ ] The new eval block in `contracts/eval-ci.ts` is byte-identical between the server and client copies (verified by diffing the block, not the whole file).
- [ ] `contracts/knowledge.ts`'s `AgentVersionConfig`/`AgentVersion` block is byte-identical between the two copies after the client backfill.
- [ ] No parallel/duplicate eval contract was created; `knowledge.ts`'s existing eval shapes are unmodified.
- [ ] `eval-ci.ts`'s CI / Conformance / Compose / Hook blocks are untouched (Non-goals).

**Architecture / security**
- [ ] `modules/evals/scorer.ts` and `expectations.ts` import nothing from `drizzle-orm`, `db/`, `fastify`, or `adapters/`.
- [ ] `modules/evals/*-service.ts` / `runner.ts` do not import `drizzle-orm`, `db/schema`, or `fastify`.
- [ ] `modules/evals/routes.ts` never calls `db.*` directly.
- [ ] `modules/evals/**` never imports `modules/agents/repository.ts` — agent reads go through `container.agentsRepo`.
- [ ] The runner writes **no** `reviews`, `findings`, or `agent_runs` rows and publishes nothing on `runBus`; `pull_requests.reviewed_at` is never moved by an eval run.
- [ ] Every eval route calls `getContext`; the four cost-amplifying POSTs declare `rateLimit`.
- [ ] No secret, API key, or provider credential appears in `eval_cases`, `eval_runs`, or any eval response body.
- [ ] The eval path assembles no prompt of its own — the only entry point to the engine is `runAgentReview` → `reviewPullRequest`, so `INJECTION_GUARD` and delimiter-wrapping apply unchanged. No denylist/keyword scanning was added.
- [ ] User-authored `name`/`notes`/`expected_output.title` and model-authored finding text are rendered as text, never markup.

**i18n / a11y**
- [ ] `grep -rn '"[A-Z][a-z]' client/src/components/eval client/src/app/eval client/src/app/agents/*/\_components/AgentEditor/_components/EvalsTab` finds no user-facing literal (**AC-38**).
- [ ] Every metric delta carries a textual sign or icon; no state is conveyed by colour alone.
- [ ] The max-2 batch selection and Compare are keyboard-operable; disabled Compare exposes its reason to AT.
- [ ] Numeric metric values are always rendered alongside any chart.

**Manual verification**
- [ ] Accept a finding → "Turn into eval case" appears → one click creates a case with no modal; clicking again returns the same case.
- [ ] Dismiss a finding → the created case's expectation is `must_not_flag`.
- [ ] An undecided finding shows no button.
- [ ] The Evals tab is reachable at `/agents/<id>?tab=evals`, survives a reload, and shows 8+ cases without truncation (**AC-10**).
- [ ] The sidebar "Eval Dashboard" item highlights on `/eval` and `/eval/<agentId>` (**AC-36**).
- [ ] "Run all evals" states the case count, returns immediately, and rows appear incrementally.
- [ ] A batch with zero applicable expectations renders "not applicable", not "100%".
- [ ] Promote v(N−1) while live is vN → the live agent's config equals the older snapshot and a new version is written; promoting the live version changes nothing.
- [ ] **AC-40 (the L06 sensitivity test):** run the case set → deliberately degrade the system prompt → run again → the two batches are independently recorded, comparable, and their recall and/or precision differ in the Compare view. Capture the screenshot + screencast the spec's §Delivery asks for.

**Post-merge**
- [ ] Run `/engineering-insights` and append any substantive, non-obvious learning to the relevant `insights.md` (dedupe first; write nothing if nothing qualifies).

---

## 5. Risks and assumptions

**Risks**

1. **Eval runs cost real money and the trigger is one click.** An 8-case batch is 8 paid calls;
   "Run all agents" is N×M. Mitigations built in: rate limits on all four triggers, the 409
   in-flight guard (AC-23), sequential execution (no fan-out), a per-case timeout, and a UI that
   states the case count before confirming. There is deliberately **no** spend cap — cost is
   reported, not enforced (a spec Non-goal). Accept that a misclick on "Run all agents" spends money.
2. **`pnpm db:generate` has a documented history of proposing phantom changes** from corrupted
   `0011`/`0012` snapshots. Step 1's isolation procedure exists specifically for this. If the
   generator proposes anything beyond the two columns and three indexes, **stop and report** — do
   not generate a catch-up migration (that was tried before and reverted).
3. **The two vendored `shared` copies are already drifted.** A well-meaning "sync the files" would
   drag server-only contracts (`review-diff.ts`, `AgentManifest`, the wider `Provider` unions) into
   the client and break its build. Step 1 mirrors the eval block *only*, plus the one deliberate
   `AgentVersionConfig`/`AgentVersion` backfill.
4. **`.it.test.ts` files cannot run in this environment.** Three of this plan's test files are
   DB-backed. They must be written and typechecked; their non-execution must be stated in the
   summary, not silently skipped.
5. **Eval reproducibility is bounded by repo-intel index state.** `runAgentReview` enriches the
   prompt with callers/repo-map/rank derived from the *current* index, not from a snapshot. Two
   batches of the same case set with the same prompt can therefore differ slightly if the repo was
   re-indexed between them. This is not a spec violation (the frozen thing is `input_diff`, AC-24)
   but it is a real confound for AC-40's sensitivity test — re-run both sides close together.
6. **A hand-authored case has no `repo_id`.** `runAgentReview` requires a `repoId`; the runner passes
   `input_meta.repo_id ?? ''`. All three enrichment helpers already `try/catch` and degrade to
   "no enrichment" (`agent-runner.ts:146-223`), so this is safe — but do not treat empty enrichment
   as an error (`server/AGENTS.md`).
7. **`isConfigChange`'s signature change touches a hot path.** Every agent update flows through it.
   The guard is that the new clause is inert unless `skillIds` is present on **both** sides — Step 5's
   hermetic table test must lock that in before the integration tests are trusted.
8. **Micro-averaged batch metrics are not the mean of per-row metrics.** An implementer who
   aggregates by averaging the `recall`/`precision` columns will produce numbers that look plausible
   and are wrong. The counts in `actual_output` (D3) are the only correct aggregation source.

**Assumptions**

1. **One API instance per DB** — already assumed by the existing orphan-run reaper
   (`server/AGENTS.md`); the in-memory batch registry (D7) inherits that assumption. Replicas would
   allow two concurrent batches for one agent.
2. **One owner per case** — the spec's `[NEEDS CLARIFICATION] 1` is explicitly non-blocking and
   resolved to "one owner"; `eval_cases.ownerKind` keeps its `'skill'` variant so a later skill-eval
   feature is not precluded (spec Non-goals).
3. **Trend/history retention** — `[NEEDS CLARIFICATION] 2` is non-blocking; this plan bounds the
   *window* (`TREND_WINDOW_BATCHES = 20`, `MAX_RECENT_RUNS = 50`) and prunes nothing. Changing the
   numbers later changes no acceptance criterion.
4. **"Run on save" semantics** — `[NEEDS CLARIFICATION] 3` is non-blocking; the toggle is
   **component-local state**, not persisted anywhere. No contract, column, or setting.
5. **Only the `en` locale exists** (`client/messages/en/`), so AC-38 means "goes through
   `useTranslations`", not "is translated".
6. **`eval-cases`/`eval-runs` route ids are uuids** — validated with `IdParams`/`z.string().uuid()`
   at the edge, so a malformed id 422s rather than reaching Postgres.
