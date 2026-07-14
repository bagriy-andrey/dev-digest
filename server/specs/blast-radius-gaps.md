# Spec: Blast Radius — design-gap closure (stats line + prior PRs)

**Status:** planning
**Scope:** `server/` + `client/` (one combined spec, owned by `server/`, mirroring the
parent `server/specs/blast-radius.md` convention).

**Relationship to the parent spec:** this **extends** the already-shipped
`server/specs/blast-radius.md` (Status: implemented per `server/insights.md` /
`client/insights.md` 2026-07-09 Session Notes). It is a **new sibling file**, not an
amendment to that document — every feature in `server/specs/` gets its own file, and the
parent spec is done; muddying a completed spec with a follow-up would be harder to read than
a focused delta. Read the parent first for the full feature context; this file only covers the
two confirmed gaps vs. the original design mockup.

Closes the two gaps recorded in `client/insights.md`'s Open Questions (2026-07-09):

1. **Aggregate stats line** next to the "BLAST RADIUS" title in BOTH the compact
   `BlastRadiusCard` (Overview tab) and the full `BlastTab` — `N symbols · N callers · N
   endpoints · N cron`. Pure client-side derivation from data the `BlastRadius` contract
   already carries; no new API call, no contract change, no migration.
2. **"Prior PRs touching these files"** collapsible section at the bottom of the Blast Radius
   card/tab — other PRs in the same repo whose changed files overlap this PR's. Needs new
   server work: one vendored-contract field, one repository query, service wiring, and UI in
   both components.

The compact card stays **Tree-only** (no Graph toggle) — a deliberate, already-recorded
decision (§6), NOT touched here.

---

## 0. What already exists (do not touch / do not recreate)

Read from the codebase, not assumed.

| Artifact | State | Location |
|---|---|---|
| `BlastRadius` / `DownstreamImpact` / `BlastCaller` / `ChangedSymbol` zod contracts (both vendored copies, byte-identical) | ✅ `changed_symbols[]` + `downstream[]` (each `callers[]`/`endpoints_affected[]`/`crons_affected[]`) + `summary` — everything Gap 1 needs is already here | `server/src/vendor/shared/contracts/brief.ts:16-44` · `client/src/vendor/shared/contracts/brief.ts:16-44` |
| `PrHistory`/`PrHistoryItem` contract (`PrBrief.history`) | ✅ exists but is a **different, unbuilt** `PrBrief` section — do NOT repurpose it for Gap 2; it is not wired and its shape (`merged_at`/`author`/`notes`) is heavier than this card needs | `.../contracts/brief.ts:64-78` |
| `BlastService.get()` / `.summarize()` — composes `repoIntel.getBlastRadius()` via `toBlastRadius`, attaches `degraded`/`degraded_reason` | ✅ the composition point Gap 2 extends; already has `this.repo` (`ReviewRepository`) and the PR's `files` array in scope | `server/src/modules/blast/service.ts:47-64` (get) · `:73-133` (summarize) |
| `toBlastRadius(result)` pure mapper + `EMPTY_BLAST_RADIUS` | ✅ pure, no I/O; Gap 2 adds a `prior_prs: []` structural default here | `server/src/modules/blast/helpers.ts` |
| `BlastRadiusResponse = BlastRadius.extend({ degraded, degraded_reason })` — local route extension | ✅ pattern reference; Gap 2 does NOT add `prior_prs` here (it goes in the vendored contract — see §1.A rationale) | `server/src/modules/blast/routes.ts:26-29` |
| `ReviewRepository` facade + `pull.repo.ts` query module (`getPull`/`getPrFiles`) | ✅ the repository layer Gap 2's new overlap query lives in | `server/src/modules/reviews/repository.ts:38-40` · `.../repository/pull.repo.ts:29-34` |
| `pr_files` table `{ id, prId, path, additions, deletions, patch }` + `pull_requests` `{ id, repoId, number, title, … }` | ✅ the overlap query joins these two by `pr_id`, scoped by `repo_id` — supports the query with NO new table/column/index (indexes exist implicitly via FKs; overlap is a plain filtered join) | `server/src/db/schema/pulls.ts:5-45` |
| `BlastRadiusResult = BlastRadius & { degraded?; degraded_reason? }` client type | ✅ automatically gains `prior_prs` once the vendored `BlastRadius` does — NO edit to `client/src/lib/types.ts` needed | `client/src/lib/types.ts:48-51` |
| `usePrBlast(prId)` / `useSummarizeBlast(prId)` hooks | ✅ unchanged — same endpoint, richer payload | `client/src/lib/hooks/blast.ts` |
| `BlastRadiusCard` (compact, Tree-only, Overview) — already receives an (unused) `repoId` prop; already uses `next/link` `<Link href="?tab=blast">` | ✅ Gap 1+2 edit this file; `repoId` is already passed by `OverviewTab` (interface requires it) so no `OverviewTab` change is needed | `client/.../_components/BlastRadiusCard/BlastRadiusCard.tsx` |
| `BlastTab` (full Tree/Graph) — does NOT currently receive `repoId` | ✅ Gap 1+2 edit this file; Gap 2's PR links need `repoId` threaded from `page.tsx` (one new prop) | `client/.../_components/BlastTab/BlastTab.tsx` · usage `page.tsx:191` |
| PR-detail navigation is by **PR number**: route `/repos/[repoId]/pulls/[number]`; `PRRow` does `router.push(`/repos/${repoId}/pulls/${pr.number}`)` | ✅ Gap 2's prior-PR links reuse this exact shape via `next/link` — do NOT invent a by-id route | `client/.../pulls/_components/PRRow/PRRow.tsx:33` · route folder `[number]` |
| `blast.*` i18n block (`callersCount`/`impactsCount`/`noCallers`/`tree`/`graph`/… with ICU plurals) | ✅ sibling keys added here follow the same ICU-plural style | `client/messages/en/prReview.json:125-143` |
| `helpers.test.ts` asserts `EMPTY_BLAST_RADIUS` toEqual `{changed_symbols,downstream,summary}` AND `BlastRadius.parse(EMPTY_BLAST_RADIUS)` | ⚠️ WILL BREAK when `prior_prs` is added — this test file MUST be updated in the same step | `server/src/modules/blast/helpers.test.ts:85-87` |
| `blast.it.test.ts` (6 cases) | ✅ extend with prior-PRs assertions | `server/test/blast.it.test.ts` |

### Gotchas baked in from insights (read once, apply throughout)

- **Vendored `@devdigest/shared` has two hand-synced copies.** `reviewer-core` aliases to the
  *server's* copy, so editing `server/src/vendor/shared/contracts/brief.ts` covers server +
  reviewer-core; only `client/src/vendor/shared/contracts/brief.ts` needs separate hand-mirroring
  (root `insights.md`). Gap 2 edits BOTH `brief.ts` copies — they must stay byte-identical.
- **`tsx watch` does NOT hot-reload `vendor/shared/**`** — after the contract edit the server
  process must be killed/restarted for the new field to take effect (`server/insights.md`). Not a
  code issue, just a dev-loop note for whoever runs it live.
- **`db:generate` must show ZERO drift** — Gap 2 adds no table/column, only a new SELECT. If
  `db:generate` proposes anything, suspect the known stale-snapshot metadata bug
  (`server/insights.md` `0011`/`0012`/`cost_usd`), not real drift from this work.
- **Client lists thrash after refetch unless sorted deterministically** (`client/insights.md`).
  The prior-PRs overlap query returns a stable order (`ORDER BY number DESC`) server-side so the
  UI needs no client re-sort.
- **Every new user-facing string is a `next-intl` key** — no hardcoded copy (`client/insights.md`
  flags several pre-existing violations; don't add another). The stats line and prior-PRs labels
  are all `prReview.blast.*` keys.
- **Client data only through `lib/hooks/*`** — no `fetch` in a component. Gap 1 is pure
  presentation over the existing `usePrBlast` payload; Gap 2 enriches that same payload
  server-side, so no new hook/endpoint is added.
- **Pure derivations live in a standalone, unit-testable helper**, not inline in a component body
  (`ui-architecture` — business logic at the lowest layer). The stats derivation is shared by two
  components in separate folders, so it goes in `client/src/lib/` (a domain "helper", sibling to
  `github-urls.ts`), not co-located under one component.

---

## 1. Module breakdown (dependency order: server contract/repo/service → client)

### 1.A `server/` — Gap 2 only (prior-PRs overlap)

Gap 1 is client-only; the server is untouched by it.

**Design decisions (locked, not left open):**

- **Where it computes:** inside `BlastService` (`service.ts`), reusing the `this.repo`
  (`ReviewRepository`) and the already-fetched `files` array — NOT a separate route-level query.
  Both `get()` and `summarize()` attach it (a shared private helper avoids drift), so a summarized
  response carries prior PRs too.
- **Count vs. full list:** return the **full list up front** (`{ id, number, title }[]`),
  `count = prior_prs.length`. Justification: the mockup badge shows a small number ("3"); PR
  counts here are tens, not thousands; and the overlap query is a single filtered join. Returning
  the list avoids a second round-trip when the user expands the collapsed row — strictly cheaper
  than a count-now + list-later two-endpoint design, at negligible extra payload for the common
  small case.
- **Contract placement:** a new **`prior_prs` field on the vendored `BlastRadius` contract**
  (both copies), NOT a route-local `.extend()` like `degraded`. Rationale: `degraded` is
  transport-only *observability* deliberately kept out of the LLM/`PrBrief` domain shape; `prior_prs`
  is genuine *feature data* the client renders and a legitimate part of the impact picture. The
  task brief directs this placement. Note `summarize()` sends only `radius.downstream` to the LLM
  (`service.ts:117`), so `prior_prs` never bloats the model prompt regardless.
- **No new table/migration:** the overlap is a plain `SELECT DISTINCT` join over existing
  `pr_files` + `pull_requests`. Confirmed against the schema (§0). Design toward "no new table"
  holds.

**Modify `server/src/vendor/shared/contracts/brief.ts`** (Blast radius block, `:16-44`) — add a
`PriorPr` object and a required `prior_prs` array on `BlastRadius`:

```ts
export const PriorPr = z.object({
  id: z.string(),
  number: z.number().int(),
  title: z.string(),
});
export type PriorPr = z.infer<typeof PriorPr>;

export const BlastRadius = z.object({
  changed_symbols: z.array(ChangedSymbol),
  downstream: z.array(DownstreamImpact),
  prior_prs: z.array(PriorPr),   // NEW — other PRs in this repo touching the same files
  summary: z.string(),
});
```

`prior_prs` is a **required array** (empty when there's no overlap), consistent with
`changed_symbols`/`downstream` being required arrays — not `.optional()`. This makes the "no
overlap" state an explicit `[]`, and every producer must populate it (the pure mapper defaults it,
the service overrides it — below). `PrBrief.blast` (`.../brief.ts:116-122`) is unbuilt scaffolding
with no producers (root `insights.md`), so a new required field breaks nothing.

**Modify `client/src/vendor/shared/contracts/brief.ts`** — mirror the exact same `PriorPr` +
`prior_prs` addition by hand (byte-identical). This is the one client file in the server-facing
step; it is disjoint from all client component files in §1.B.

**Modify `server/src/modules/reviews/repository/pull.repo.ts`** — add the overlap query
(imports grow from `{ and, eq }` to also include `ne`, `inArray`, `desc`):

```ts
export async function getPrsTouchingFiles(
  db: Db,
  repoId: string,
  excludePrId: string,
  paths: string[],
): Promise<{ id: string; number: number; title: string }[]> {
  if (paths.length === 0) return [];
  return db
    .selectDistinct({
      id: t.pullRequests.id,
      number: t.pullRequests.number,
      title: t.pullRequests.title,
    })
    .from(t.pullRequests)
    .innerJoin(t.prFiles, eq(t.prFiles.prId, t.pullRequests.id))
    .where(
      and(
        eq(t.pullRequests.repoId, repoId),
        ne(t.pullRequests.id, excludePrId),
        inArray(t.prFiles.path, paths),
      ),
    )
    .orderBy(desc(t.pullRequests.number));
}
```

Security (per `security` skill): `repoId` and `paths` are DB-sourced (the current PR's own
workspace-scoped row + its `pr_files.path` values), never raw user input; `excludePrId` is the
validated URL param; the query is fully parameterized (no interpolation). `inArray(paths)` is
bounded by the PR's file count (tens–low-hundreds) — acceptable, noted in §5. No secret read.
Workspace tenancy is already enforced upstream: `get()`/`summarize()` call `getPull(workspaceId,
prId)` first and 404 before this query runs, and the overlap is scoped to the same `repoId`, so it
can never surface a PR from another workspace's repo.

**Modify `server/src/modules/reviews/repository.ts`** — add the facade delegate next to
`getPrFiles` (`:38-40`):

```ts
getPrsTouchingFiles(repoId: string, excludePrId: string, paths: string[]) {
  return pullRepo.getPrsTouchingFiles(this.db, repoId, excludePrId, paths);
}
```

**Modify `server/src/modules/blast/helpers.ts`** — the pure mapper legitimately has no PR-history
data, so it sets the structural default:

- `EMPTY_BLAST_RADIUS`: add `prior_prs: []`.
- `toBlastRadius(result)`: return `{ changed_symbols, downstream, prior_prs: [], summary: '' }`
  (the service overrides `prior_prs`; the mapper stays pure and DB-unaware).

**Modify `server/src/modules/blast/service.ts`** — attach the real `prior_prs` in both `get()`
and `summarize()` via a shared private helper (single source of truth, no drift):

```ts
private async priorPrsFor(repoId: string, prId: string, paths: string[]) {
  return this.repo.getPrsTouchingFiles(repoId, prId, paths);
}
```

- In `get()` (after `files` is non-empty, `:53-63`): compute
  `const prior_prs = await this.priorPrsFor(pull.repoId, prId, files.map(f => f.path));`, then
  build `const radius = { ...toBlastRadius(result), prior_prs };` and use that in BOTH the
  `result.degraded == null` return and the degraded-fields return. The `EMPTY_BLAST_RADIUS`
  early-return (`files.length === 0`, `:54`) stays as-is: no files ⇒ no possible overlap ⇒
  `prior_prs: []` (already in the updated `EMPTY_BLAST_RADIUS`).
- In `summarize()`: after `const radius = toBlastRadius(result)` (`:84`), compute the same
  `prior_prs` and thread `{ ...radius, prior_prs }` through the empty-symbols early-return (`:92-94`)
  AND the final `{ ...radius, ...degradedFields, summary: ... }` return (`:132`). (The
  `files.length === 0` early-return at `:78` stays `EMPTY_BLAST_RADIUS`.)

No route change: `BlastRadiusResponse` (`routes.ts:26`) is `BlastRadius.extend({...})`, so it picks
up `prior_prs` automatically the moment the vendored `BlastRadius` gains it — the response schema
and serialization stay correct with zero edits to `routes.ts`.

**Modify `server/src/modules/blast/helpers.test.ts`** — update the two assertions that will break
(`:85-87`): `EMPTY_BLAST_RADIUS` now equals `{ changed_symbols: [], downstream: [], prior_prs: [],
summary: '' }`, and it still round-trips `BlastRadius.parse`. Add a case asserting `toBlastRadius`
returns `prior_prs: []` (the mapper never fabricates prior PRs).

**Modify `server/test/blast.it.test.ts`** — add prior-PRs coverage: seed a repo with the target PR
plus (a) another PR sharing ≥1 `pr_files.path` and (b) a PR sharing none; assert `GET
/pulls/:id/blast` returns `prior_prs` containing (a) — with `{ id, number, title }` — and NOT (b)
nor the PR itself; order is `number DESC`; a PR with zero `pr_files` returns `prior_prs: []`.

### 1.B `client/` — Gap 1 (stats line) + Gap 2 (prior-PRs section)

Both gaps edit the SAME two component files (`BlastRadiusCard.tsx`, `BlastTab.tsx`) and the same
`prReview.json`, so they cannot be separate parallel steps — they are one client wiring step
(§3 Step 3). The pure stats helper is a separate file (Step 2) so it is validated independently.

**Create `client/src/lib/blast-stats.ts`** (pure, unit-testable domain helper — sibling to
`github-urls.ts`; shared by both components, so it lives in `lib/` not co-located):

```ts
import type { BlastRadius } from "./types";

export interface BlastStats { symbols: number; callers: number; endpoints: number; crons: number; }

/** Aggregate counts for the header stats line. Endpoints/crons are de-duped
 *  across all downstream entries (the same endpoint/cron can be reachable from
 *  more than one changed symbol). */
export function computeBlastStats(blast: BlastRadius): BlastStats {
  const endpoints = new Set<string>();
  const crons = new Set<string>();
  let callers = 0;
  for (const d of blast.downstream) {
    callers += d.callers.length;
    for (const e of d.endpoints_affected) endpoints.add(e);
    for (const c of d.crons_affected) crons.add(c);
  }
  return {
    symbols: blast.changed_symbols.length,
    callers,
    endpoints: endpoints.size,
    crons: crons.size,
  };
}
```

Uses only fields present in today's contract — has NO dependency on Gap 2's `prior_prs`, so Step 2
can be built/tested in parallel with the server step.

**Create `client/src/lib/blast-stats.test.ts`** — table-driven: empty blast → all zeros; callers
summed across downstream entries; endpoints/crons de-duped across entries (an endpoint appearing
under two symbols counts once); singular vs plural boundary values (0/1/2) so the component's ICU
plurals are exercised against real counts.

**Modify `client/messages/en/prReview.json`** (the `blast` block, `:125-143`) — add:

- Stats line (four ICU-plural keys, joined by `" · "` in the component):
  - `"statsSymbols": "{count} {count, plural, one {symbol} other {symbols}}"`
  - `"statsCallers": "{count} {count, plural, one {caller} other {callers}}"`
  - `"statsEndpoints": "{count} {count, plural, one {endpoint} other {endpoints}}"`
  - `"statsCrons": "{count} {count, plural, one {cron} other {crons}}"`
- Prior-PRs section:
  - `"priorPrs": "Prior PRs touching these files"`
  - (count is rendered as a badge from `prior_prs.length` — no separate key needed, but if a
    labeled count is preferred: `"priorPrsCount": "{count}"` — keep it minimal.)

**Modify `client/.../_components/BlastRadiusCard/BlastRadiusCard.tsx`** — inside the data branch
(after the `degraded`/`summary` blocks, `:59-67`, before the `symbolList`):

- Gap 1: render `const stats = computeBlastStats(blast);` as a stats line —
  `{t("blast.statsSymbols",{count:stats.symbols})} · {t("blast.statsCallers",{count:stats.callers})}
  · {t("blast.statsEndpoints",{count:stats.endpoints})} · {t("blast.statsCrons",{count:stats.crons})}`.
  Place it directly under the `SectionLabel` header (matching the mockup's "next to the title"
  intent) — a single muted line in a new `s.statsLine` style. Rendered only in the data branch (not
  in the loading/empty branches).
- Gap 2: below the `symbolList`, render the prior-PRs section **only when
  `blast.prior_prs.length > 0`** (same "don't show empty sections" convention as the
  endpoint/cron chip rows). A collapsible row (local `useState<boolean>` `priorOpen`, default
  collapsed to match the mockup): a clock `Icon.Clock` + `t("blast.priorPrs")` + a count badge
  (`<Badge>{blast.prior_prs.length}</Badge>`), toggling to reveal a list of
  `<Link href={`/repos/${repoId}/pulls/${pr.number}`} key={pr.id}>#{pr.number} {pr.title}</Link>`
  — reuse the existing `repoId` prop (already destructured into the component signature for this)
  and the existing `next/link` import. Use the existing PR-number route shape; do NOT invent a
  by-id link.

**Modify `client/.../_components/BlastRadiusCard/styles.ts`** — add `statsLine` (muted, ~12px,
flex row) and the prior-PRs styles (`priorSection`, `priorHeader` button, `priorList`, `priorLink`),
mirroring the existing `symbolRow`/`symbolHeader`/`callerList` conventions and CSS-var usage.

**Modify `client/.../_components/BlastRadiusCard/BlastRadiusCard.test.tsx`** — RTL: the stats line
renders the four counts (assert de-dupe: an endpoint under two symbols shows "1 endpoint"); the
prior-PRs section is absent when `prior_prs` is `[]` and present (with the count badge and a
clickable `#number title` link pointing at `/repos/:repoId/pulls/:number`) when populated;
collapsed-by-default then expands on click.

**Modify `client/.../_components/BlastTab/BlastTab.tsx`** — add a `repoId: string` prop to
`BlastTabProps` (needed for Gap 2 links). Then:

- Gap 1: render the same `computeBlastStats` line under the `SectionLabel` (`:40-63`), before the
  `degraded`/`summary`/view blocks — reuse the same four i18n keys.
- Gap 2: render the prior-PRs collapsible section (same conditional `prior_prs.length > 0`, same
  `<Link>` shape using the new `repoId` prop) at the bottom of the tab, below both the Tree and
  Graph view branches (it belongs to the whole map, not one view) — i.e. after the `view === "tree"
  ? … : …` block, still inside the `<section>`.

**Modify `client/.../_components/BlastTab/styles.ts`** — add the same `statsLine` + prior-PRs
styles (co-located; do not import across component folders).

**Modify `client/.../_components/BlastTab/BlastTab.test.tsx`** — RTL: stats line renders; prior-PRs
section conditionally renders and links resolve to the number route; the new `repoId` prop is
threaded (update the test's render call to pass it).

**Modify `client/.../pulls/[number]/page.tsx`** — thread `repoId` into `BlastTab` at `:191`:
`{tab === "blast" && <BlastTab prId={prId} repoId={repoId} onOpenInDiff={openInDiff} />}` (`repoId`
is already in scope from `useParams`, `:31`). No other `page.tsx` change — `OverviewTab` already
passes `repoId` to `BlastRadiusCard` (`:149`), so the card needs no new plumbing.

---

## 2. Dependency changes

- **New packages:** none.
- **DB migrations:** none — Gap 2 is a `SELECT DISTINCT` join over existing `pr_files` +
  `pull_requests`; no table/column/index added. `db:generate` MUST report zero drift.
- **Env vars:** none.
- **Vendored `@devdigest/shared`:** `PriorPr` + `prior_prs` added to `BlastRadius` in **both**
  `brief.ts` copies by hand (server copy covers server + reviewer-core; client copy mirrored
  separately) — keep byte-identical. No `platform.ts`/`feature-models.ts` change (no new feature
  model — Gap 2 makes zero LLM calls).
- **Client `lib/types.ts`:** no edit — `BlastRadiusResult` transitively gains `prior_prs` via
  `BlastRadius`.

---

## 3. Execution order (disjoint file ownership per step → parallel-safe)

File lists are disjoint across steps. **Steps 1 and 2 have no dependency on each other and run in
parallel.** Step 3 depends on both (Step 1 for the `prior_prs` contract field, Step 2 for the stats
helper).

**Step 1 — server: prior-PRs contract + query + service wiring + server tests** (no deps)
Owns:
- `server/src/vendor/shared/contracts/brief.ts` (add `PriorPr` + `prior_prs`)
- `client/src/vendor/shared/contracts/brief.ts` (mirror — byte-identical)
- `server/src/modules/reviews/repository/pull.repo.ts` (add `getPrsTouchingFiles`)
- `server/src/modules/reviews/repository.ts` (facade delegate)
- `server/src/modules/blast/helpers.ts` (`prior_prs: []` in mapper + `EMPTY_BLAST_RADIUS`)
- `server/src/modules/blast/helpers.test.ts` (update the two breaking assertions + mapper case)
- `server/src/modules/blast/service.ts` (attach `prior_prs` in `get()` + `summarize()`)
- `server/test/blast.it.test.ts` (add prior-PRs assertions)
Depends on: nothing.
Test: `cd server && pnpm typecheck` + hermetic unit suite
(`pnpm exec vitest run --exclude '**/*.it.test.ts'`) — `helpers.test.ts` green with the new field;
`BlastRadius.parse` accepts `prior_prs`. `pnpm db:generate` reports **no** schema diff.
`blast.it.test.ts` (real PG — may not run in this sandbox per `server/insights.md`; verify by close
read + typecheck) asserts overlap correctness, self-exclusion, `number DESC` order, and
`prior_prs: []` for a no-files PR. Both vendored `brief.ts` copies are byte-identical (diff them).

**Step 2 — client: pure stats helper + unit test** (no deps)
Owns:
- `client/src/lib/blast-stats.ts`
- `client/src/lib/blast-stats.test.ts`
Depends on: nothing (uses only today's `BlastRadius` fields; independent of Step 1).
Test: `cd client && pnpm typecheck && pnpm test` — `computeBlastStats`: empty → zeros; callers
summed; endpoints/crons de-duped across downstream entries; 0/1/2 boundaries.

**Step 3 — client: stats line + prior-PRs UI in both components + i18n + page wiring**
(depends on Step 1's `prior_prs` field AND Step 2's `computeBlastStats`)
Owns:
- `client/messages/en/prReview.json` (new `blast.*` keys)
- `client/.../_components/BlastRadiusCard/BlastRadiusCard.tsx`
- `client/.../_components/BlastRadiusCard/styles.ts`
- `client/.../_components/BlastRadiusCard/BlastRadiusCard.test.tsx`
- `client/.../_components/BlastTab/BlastTab.tsx`
- `client/.../_components/BlastTab/styles.ts`
- `client/.../_components/BlastTab/BlastTab.test.tsx`
- `client/.../pulls/[number]/page.tsx` (thread `repoId` into `BlastTab`)
Depends on: Step 1, Step 2.
Test: `cd client && pnpm typecheck && pnpm test`. RTL over both components: stats line shows the
four correct (de-duped) counts; prior-PRs section absent when `prior_prs` is empty, present with a
count badge + clickable `#number title` links to `/repos/:repoId/pulls/:number` when populated,
collapsed-by-default; `BlastTab` receives and uses `repoId`. No hardcoded copy — every new string
is a `prReview.blast.*` key.

**Parallelizable clusters:** Steps 1 ‖ 2 in parallel; Step 3 after both.

---

## 4. Definition of Done (whole feature)

Typecheck / tests:
- [ ] `cd server && pnpm typecheck` and `pnpm test` (unit incl. updated `helpers.test.ts`;
      `blast.it.test.ts` written + typechecked, executed if the sandbox can run PG).
- [ ] `cd client && pnpm typecheck && pnpm test` (new `blast-stats.test.ts` + updated component
      tests).
- [ ] `pnpm db:generate` shows **no** schema drift (no migration expected — if one appears,
      suspect the known stale-snapshot bug, not real drift).
- [ ] Both `brief.ts` vendored copies are byte-identical (`diff` them).

Behavioral / gap coverage:
- [ ] **Gap 1:** the "N symbols · N callers · N endpoints · N cron" line renders next to the
      "BLAST RADIUS" title in BOTH the compact `BlastRadiusCard` and the full `BlastTab`, with
      endpoints/crons de-duped across changed symbols and correct singular/plural forms.
- [ ] **Gap 2:** `GET /pulls/:id/blast` returns `prior_prs: { id, number, title }[]` — other PRs
      in the same repo sharing ≥1 changed file path, excluding the current PR, newest-first;
      `[]` when there's no overlap or no `pr_files`.
- [ ] **Gap 2:** a collapsible "Prior PRs touching these files" row (clock icon + count badge)
      appears at the bottom of BOTH the card and the tab **only when non-empty**, collapsed by
      default; expanding lists each prior PR as a `#number title` link that navigates to
      `/repos/:repoId/pulls/:number` (the existing PR-number route — no new deep-link mechanism).
- [ ] `summarize()`'s response also carries `prior_prs` (it does not silently drop it).
- [ ] Zero new LLM calls (Gap 2 is a pure DB read); the compact card stays Tree-only.
- [ ] i18n: all new strings are `prReview.blast.*` keys; no hardcoded copy added.

Edge cases:
- [ ] PR with zero `pr_files` → `prior_prs: []`, stats line all zeros (or the existing empty-state
      branch, which renders before the stats line).
- [ ] An endpoint/cron reachable from two changed symbols counts once in the stats line.
- [ ] A degraded/partial index still renders the stats line + prior-PRs section over whatever data
      IS present (never a blank screen) — same precedence as today's degraded badge.
- [ ] A large PR (hundreds of files) still runs the overlap query without error (bounded
      `inArray`; see §5).

---

## 5. Risks and assumptions

- **`prior_prs` becomes part of the domain `BlastRadius` (and thus `PrBrief.blast`).** This
  deliberately diverges from `degraded`'s route-local `.extend()` treatment, because `prior_prs` is
  feature data, not transport observability. `PrBrief` is unbuilt scaffolding with no producers
  (root `insights.md`), so a new required field breaks nothing today; a future `PrBrief` composer
  must supply it (empty `[]` is valid). `summarize()` sends only `downstream` to the LLM, so the
  new field never inflates the model prompt.
- **Overlap is exact-path, file-level.** Two PRs "touch the same file" iff they share an identical
  `pr_files.path` string. Renames (path A→B) won't match; a PR that changed a file under its old
  path vs. new path is treated as non-overlapping. This is the cheap, honest v1 (matches the
  mockup's simple count). Rename-aware overlap is out of scope.
- **`inArray(paths)` is bounded by the PR's own file count** (tens–low-hundreds). Postgres handles
  this comfortably as a parameterized `IN`. If a pathological PR ever changes thousands of files,
  the query cost grows linearly but stays a single indexed join — acceptable; a `path`-set cap
  could be added later if it ever matters, but is speculative now.
- **The `prior_prs` list is unbounded in count.** In practice small (the mockup's "3"), but a
  hot file touched by hundreds of historical PRs would return a long list. Since the UI collapses
  it by default and only the count shows until expanded, this is a UI-scroll concern at worst, not
  a correctness/perf one. A server-side `LIMIT` + "and N more" is a clean later addition, not built
  now (would otherwise force the two-round-trip design this spec explicitly avoids).
- **Assumption:** `ReviewRepository.getPull`/`getPrFiles` behave as in `BlastService` today
  (confirmed by reading the service) — the new `getPrsTouchingFiles` follows the identical
  `pull.repo.ts` + facade pattern, no new repository class.
- **Assumption:** `BlastRadiusCard` already receives `repoId` from `OverviewTab` (its prop
  interface requires it, so typecheck already enforces the pass) — verified against the current
  card signature; only `BlastTab` needs the new prop threaded from `page.tsx`.

---

## 6. Out of scope (explicit — do not silently attempt or drop)

- **No Tree/Graph toggle on the compact `BlastRadiusCard`** — a deliberate, already-recorded
  decision (card = Tree-only; Graph lives only on `BlastTab`), per the card's own comment and
  `server/insights.md`'s 2026-07-09 Session Notes. Not touched.
- **No change to the collapsed-by-default symbol-row interaction** — a minor mockup UX difference
  intentionally excluded.
- **No `reviewer-core` or `mcp-server` change** — server + client only.
- **No DB schema / migration change** — Gap 2 is a plain SELECT over existing tables.
- **No reuse of the `PrHistory`/`PrBrief.history` contract** for Gap 2 — it is a different,
  unbuilt `PrBrief` section with a heavier shape; `prior_prs` is its own minimal field on
  `BlastRadius`.
- **No new endpoint or hook** — Gap 2 enriches the existing `GET /pulls/:id/blast` payload;
  `usePrBlast`/`useSummarizeBlast` are unchanged.
- **No rename-aware or fuzzy file overlap, no `LIMIT`/pagination** on `prior_prs` in v1 (§5).
- **No new feature model / LLM call** — Gap 2 is deterministic DB reads.
```