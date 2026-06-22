# Feature spec — Per-run cost (PR list + PR detail + run trace)

Status: proposed · Owner: TBD · Date: 2026-06-20

## 1. Goal (one sentence)

Surface the **USD cost** (and accompanying tokens) of agent review runs in three
places, reusing the cost the engine **already computes** — no new model calls.

> Принцип зі слайда: «вартість і токени кожного прогону — у двох місцях»,
> «Нуль додаткових викликів моделі».

## 2. Scope — three UI surfaces

| # | Screen | What renders | Source field |
|---|--------|--------------|--------------|
| 1 | **PR list** (`/repos/:id/pulls`) | new `COST` column, compact `$0.012` | latest completed run's `cost_usd` for the PR |
| 2 | **PR detail → Agent runs timeline** | per-run line near the time: `8.2K→1.3K · $0.013` | each run's `cost_usd` |
| 3 | **Run trace drawer → Stats** | a `COST` stat card next to DURATION / TOKENS / FINDINGS | the run's `cost_usd` |

Rules (from the slide):
- A **completed** run shows the badge.
- **No data → `—`, never `$0.00`.** (`cost_usd === null` ⇒ dash. A genuine
  zero-cost run is effectively unreachable, so treat null/undefined as "unknown".)
- Failed/cancelled runs ⇒ `cost_usd = null` (we charge nothing meaningful and
  the engine never returned a number).

## 3. The key finding — cost already exists end-to-end in the engine

`reviewer-core` already produces cost; nothing in the engine changes.

- `reviewer-core/src/llm/openrouter.ts` requests `usage: { include: true }`,
  reads `res.usage.cost` (OpenRouter USD extension), and falls back to an injected
  `estimateCost(model, tokensIn, tokensOut)` price table. Returns
  `StructuredResult.costUsd: number | null`.
- `reviewer-core/src/review/run.ts` accumulates per-chunk cost into
  `ReviewOutcome.costUsd: number | null`.

The leak is purely on the server boundary: the run executor reads `tokensIn`/
`tokensOut`/`grounding` from the outcome but **drops `costUsd`**.

## 4. Data semantics decision (needs sign-off)

**PR-list cost = the latest _completed_ run's `cost_usd`** for that PR. This mirrors
the existing list `score` (= latest review score) and keeps the column a single
scalar. Null when the PR has no completed run.

Alternative considered: **sum of all runs' cost** ("total spent reviewing this PR").
More analytics-y but doesn't match the `score` pattern and is easy to add later.
→ Recommend **latest-run** for v1; revisit if users ask for cumulative spend.

## 5. Implementation plan

### 5.1 DB — re-add the dropped column

`server/src/db/schema/runs.ts` — add to `agentRuns` (alongside `tokensIn`/`tokensOut`):

```ts
costUsd: doublePrecision('cost_usd'),   // nullable; matches eval_runs/ci_runs.costUsd
```

Then `cd server && pnpm db:generate` (NEVER hand-edit migrations) → new migration
re-adds `cost_usd` (it was dropped by `0009_complex_runaways.sql`). Apply with
`pnpm db:migrate` (migrations are **not** applied on boot).

### 5.2 Server — persist + expose

1. **Write path** `server/src/modules/reviews/run-executor.ts`
   - L213: `const { tokensIn, tokensOut, grounding, costUsd } = outcome;`
   - L243 `completeAgentRun(...)`: add `costUsd`.
   - L264 `trace.stats`: add `cost_usd: costUsd`.
   - Failure path (L297): pass `costUsd: null` (not 0).
2. **Repository** `server/src/modules/reviews/repository/run.repo.ts`
   - `completeAgentRun` values type + `.set({...})`: add `costUsd`.
   - `listRunsForPull` select + mapping: add `cost_usd: row.costUsd`.
   - Trace read path (`stats`): include `cost_usd`.
3. **PR-list route** `server/src/modules/pulls/routes.ts` (GET `/repos/:id/pulls`)
   - Add a `latestRunByPr` map mirroring the existing `latestReviewByPr` block
     (L114–130), but over `agent_runs` filtered `status = 'done'`,
     `prId IN (...)`, ordered `ranAt DESC`, first-seen-per-PR.
   - In the row map (L155): `cost_usd: latestRunByPr.get(r.id)?.costUsd ?? null`.
4. **Contracts** — edit the vendored `shared` **in BOTH packages** (hand-sync):
   `server/src/vendor/shared/contracts/` AND `client/src/vendor/shared/contracts/`
   - `platform.ts` → `PrMeta`: `cost_usd: z.number().nullable().optional()`
   - `trace.ts` → `RunSummary`: `cost_usd: z.number().nullable()`
   - `trace.ts` → `RunStats`: `cost_usd: z.number().nullable()`
   - (`observability.ts` `AgentColumn.cost_usd` already exists — leave as-is.)

   Routes use `fastify-type-provider-zod`: the same schema validates AND serializes,
   so adding the field to the response Zod schema is what exposes it on the wire.

### 5.3 Client — one helper + one badge (2 variants) + 3 call sites

1. **Formatter** — new `formatCurrency(usd: number | null | undefined): string`
   next to `formatTokens` in
   `client/.../RunTraceDrawer/helpers.ts` (or a shared `lib/format.ts`):
   - null/undefined ⇒ `"—"`.
   - else `$` + adaptive precision (e.g. `< $1` → 3–4 sig digits: `$0.013`;
     `≥ $1` → 2 dp: `$1.42`). Keep it `tnum`/mono for alignment.

2. **`RunCostBadge` component (2 variants)** per the slide:
   - `variant="compact"` → just `$0.012` (PR-list column).
   - `variant="withTokens"` → `8.2K→1.3K · $0.013` (timeline line).
   - Both render `—` when cost is null.

3. **Surface 1 — PR list**
   - `pulls/constants.ts`: add `"cost"` to `COLUMN_KEYS`.
   - `pulls/styles.ts`: extend `GRID` with a cost column width (e.g. `78px`),
     keep header/row in lockstep.
   - `PRRow/PRRow.tsx`: render `<RunCostBadge variant="compact" usd={pr.cost_usd} />`.
   - i18n `messages/en/prReview.json` `columns`: `"cost": "Cost"`.

4. **Surface 2 — timeline**
   - `RunHistory/RunHistory.tsx` (right-side time block ~L198): add
     `<RunCostBadge variant="withTokens" usd={r.cost_usd} tin={r.tokens_in} tout={r.tokens_out} />`.

5. **Surface 3 — trace stats**
   - `RunTraceDrawer/.../TraceBody.tsx` `statsRow`: add
     `<Stat label={t("trace.stat.cost")} val={formatCurrency(stats.cost_usd)} />`.
   - i18n `messages/en/runs.json` `trace.stat`: `"cost": "COST"`.

No data-fetching changes: `usePulls`, `usePrRuns`, `useRunTrace` already carry the
typed payloads; they pick up `cost_usd` once the contracts include it.

## 6. Testing

- **server unit (hermetic)**: PR-list route maps `cost_usd` from latest done run;
  null when no completed run. Run-executor maps `outcome.costUsd → cost_usd` and
  passes `null` on the failure path.
- **server `.it.test.ts` (real PG)**: insert agent_runs incl. `cost_usd`, assert
  `GET /pulls/:id/runs` and `GET /runs/:id/trace` echo it; assert the new
  migration round-trips.
- **client**: `formatCurrency` table (`null → —`, `0.0131 → $0.013`, `2 → $2.00`);
  `RunCostBadge` both variants incl. the dash case.
- **e2e**: deterministic — a seeded run with a known `cost_usd` shows `$X` in all
  three surfaces; a null-cost run shows `—`.

## 7. Risks / gotchas

- **Vendored `shared` drift** — the #1 footgun: edit both copies or types diverge
  silently across packages.
- **`—` vs `$0.00`** — centralize in `formatCurrency`; don't `?? 0` anywhere.
- **Old rows** — pre-migration runs have `cost_usd = NULL` → render `—`. Correct.
- **Backfill (optional, out of scope)** — historical runs stay `—` unless we
  recompute cost from stored `tokens_in/out` × a price table. Not required for v1.
- **Latest-run ≠ latest-review** — list `cost` (from agent_runs) and list `score`
  (from reviews) can in theory reference different runs; acceptable for v1.

## 8. File-touch checklist

- [ ] `server/src/db/schema/runs.ts` (+ `pnpm db:generate`, `pnpm db:migrate`)
- [ ] `server/src/modules/reviews/run-executor.ts`
- [ ] `server/src/modules/reviews/repository/run.repo.ts`
- [ ] `server/src/modules/pulls/routes.ts`
- [ ] `server/src/vendor/shared/contracts/{platform,trace}.ts`
- [ ] `client/src/vendor/shared/contracts/{platform,trace}.ts`
- [ ] `client/.../RunTraceDrawer/helpers.ts` (`formatCurrency`)
- [ ] `client/.../_components/RunCostBadge.tsx` (new)
- [ ] `client/.../pulls/{constants,styles}.ts` + `PRRow/PRRow.tsx`
- [ ] `client/.../RunHistory/RunHistory.tsx`
- [ ] `client/.../RunTraceDrawer/.../TraceBody.tsx`
- [ ] `client/messages/en/{prReview,runs}.json`
</content>
