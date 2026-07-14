# Spec: Blast Radius

**Status:** planning
**Scope:** `server/`, `client/` (one combined spec, owned by `server/`, mirroring the
cross-cutting `server/specs/intent-layer.md` / `server/specs/smart-diff.md` convention.
`modules/index.ts`'s own header comment already names `blast` as an expected future
module — this spec is that module.)

Build an "impact map" for a PR: which changed symbols (functions/classes) are touched, who
calls them further down the codebase, and which HTTP endpoints / cron jobs are reachable from
those changes — the answer to "what could this change break?" that isn't visible from the diff
alone. A new `GET /pulls/:id/blast` endpoint **reads, never writes, the repo-intel index** — it
composes data that already exists (symbols, resolved call references, file rank, per-file
endpoint/cron facts) through the `repoIntel.*` facade, with **zero LLM calls** in the core path.
The client renders it two ways: a compact `BlastRadiusCard` on the existing Overview tab (next
to `IntentCard`) and a dedicated **Blast** tab with Tree and Graph views; clicking a caller
jumps straight to that `file:line` in the existing diff viewer. A clearly-separable, **optional**
step adds a single cheap-model call that fills in a one-paragraph summary — independently
skippable, and the only place any model is invoked anywhere in this feature.

---

## 0. What already exists (do not touch / do not recreate)

| Artifact | State | Location (file:line) |
|---|---|---|
| `RepoIntelService.getBlastRadius(repoId, changedFiles)` | ✅ FULLY implemented, not a stub — two paths: ripgrep/clone fallback (always `degraded:true`) and the real persistent-index path | `server/src/modules/repo-intel/service.ts:220-304` (fallback) · `:315-391` (`tryPersistentBlast`) |
| `BlastResult` facade type `{changedSymbols, callers, impactedEndpoints, factsByFile?, degraded?, reason?}` | ✅ exists | `server/src/modules/repo-intel/types.ts:57-87` |
| `repository.ts::getResolvedCallers(repoId, declFiles, names)` — **direct (1-hop)** callers of a symbol, joined to `file_rank` | ✅ exists — the hop-1 caller source (unchanged) | `server/src/modules/repo-intel/repository.ts:503-533` |
| `repository.ts::getEdges(repoId)` — the whole import graph (`{fromFile, toFile}` = importer→imported) | ✅ exists — the hop-2 reachability source (see §1.A) | `server/src/modules/repo-intel/repository.ts:432-437` |
| `file_edges` table + its reverse index `(repoId, toFile)` whose schema comment says it "is what blast uses" | ✅ exists — confirms file-import reachability is the intended blast mechanism | `server/src/db/schema/repo-intel.ts:51-66` |
| `repository.ts::getFileFacts(repoId, files)` — per-file `{endpoints, crons}` from the `file_facts` table | ✅ exists | `server/src/modules/repo-intel/repository.ts:534-549` · schema `server/src/db/schema/repo-intel.ts:71-84` |
| `extractEndpoints` / `extractCrons` — Fastify/Express route + cron/job-schedule regex extractors, already populate `file_facts` at index time | ✅ exists | `server/src/adapters/codeindex/extract.ts` |
| `MAX_CALLERS_PER_SYMBOL = 20` — matches the brief's "cap 20 callers per symbol" exactly | ✅ exists | `server/src/modules/repo-intel/constants.ts` |
| `BlastRadius` / `DownstreamImpact` / `BlastCaller` / `ChangedSymbol` zod contracts | ✅ exists (both vendored copies, identical) | `server/src/vendor/shared/contracts/brief.ts:16-44` · `client/src/vendor/shared/contracts/brief.ts:16-44` |
| `PrBrief.blast: BlastRadius` (composed doc, unrelated features own `intent`/`risks`/`history`) | ✅ exists — this spec fills `blast` only, does not touch the composed `PrBrief` | `.../contracts/brief.ts:116-122` |
| `IntentService` — DI/module-shape template to mirror (news up `ReviewRepository` from `container.db`; workspace-scoped `NotFoundError` guard; no LLM in the plain `get`) | ✅ reference | `server/src/modules/intent/service.ts` |
| `ReviewRepository.getPull(workspaceId, prId)` / `.getPrFiles(prId)` | ✅ exists — reused for changed-files resolution (same source `IntentService`/`SmartDiffService` already use) | `server/src/modules/reviews/repository.ts` |
| `getContext` / `IdParams` — shared route helpers | ✅ exists | `server/src/modules/_shared/` |
| `modules/index.ts` registry pattern + its own comment naming `blast` as an expected module | ✅ exists | `server/src/modules/index.ts` |
| `FeatureModelId` enum + `FEATURE_MODELS` registry (per-feature model selection) | ✅ exists — pattern to mirror for the optional summary step | `server/src/vendor/shared/contracts/platform.ts:14-20,51-90` (both copies) |
| `IntentCard` + `OverviewTab` — the exact client card/placement pattern to mirror | ✅ reference | `client/src/app/repos/[repoId]/pulls/[number]/_components/IntentCard/IntentCard.tsx` · `.../OverviewTab/OverviewTab.tsx` |
| `client/src/lib/hooks/intent.ts` — the hook pattern to mirror | ✅ reference | same file |
| Click-to-code (`onOpenInDiff(file, line)` → switches to `diff` tab, scrolls to the exact line) | ✅ exists, already wired for `FindingsTab`/`FindingCard` — reuse as-is, do not rebuild | `client/.../page.tsx:75-78` (`openInDiff`), threaded into `FindingsTab` at `page.tsx:158` |
| `PrDetailHeader`'s `Tabs` (`overview` / `findings` / `diff`) | ✅ exists — add one `blast` entry | `client/.../PrDetailHeader/PrDetailHeader.tsx:111-120` |
| `client/src/lib/types.ts` — re-export hub (`PrBrief`, `SmartDiff`, `Intent` already re-exported) | ✅ exists — add `BlastRadius` | `client/src/lib/types.ts:36` |
| `messages/en/prReview.json`'s `"intent": {…}` block + `useTranslations("prReview")` | ✅ pattern to mirror for a sibling `"blast": {…}` block | `client/messages/en/prReview.json:111-124` |

**Net-new work:** a small, targeted extension inside `RepoIntelService.tryPersistentBlast`
(2-hop endpoint/cron reachability via a `file_edges` reverse-BFS — one extra `getEdges` read, the
walk itself extracted to a pure, hermetically-testable helper), a new
`server/src/modules/blast/{routes,service,helpers}.ts` module (pure mapper + thin service, no
new repository/table), one `modules/index.ts` line, one new `FeatureModelId` entry for the
optional summary step, and on the client: a hook, a compact card, a full Tree+Graph tab, tab
wiring, and click-to-code threading.

### Gotchas baked in from insights (read once, apply throughout)

- **This is the third instance of the "scaffolding exists, nothing wired" pattern** (after Intent
  Layer and Smart Diff — see root `insights.md`'s Codebase Patterns). Don't re-derive "blast
  radius is unbuilt" from a shallow grep of the `blast/` module (it doesn't exist yet) — the real
  engine (`getBlastRadius`) already lives in `repo-intel` and is NOT a stub.
- **`getBlastRadius`'s persistent path only finds DIRECT (1-hop) callers today, and attributes
  endpoints/crons only from those direct-caller files.** `getResolvedCallers` filters
  `references.declFile IN changedFiles AND toSymbol IN names` — a single hop. `BFS_DEPTH = 2`
  (`repo-intel/constants.ts`) exists but is only consumed by the unrelated `getCriticalPaths`
  (onboarding); it is NOT on the blast path today. A route handler that imports a *wrapper* that
  imports the changed helper (2 hops away) is invisible today. §1.A closes exactly this gap using
  the mechanism the brief names and the schema confirms: a **2-hop reverse-BFS over `file_edges`**
  (via the existing `getEdges`), seeded at the changed files, unioning `file_facts` endpoints/crons
  of every file that transitively imports them. This is the brief's literal step 3, and the
  `file_edges` schema comment ("the reverse-lookup index `(repoId, toFile)` is what blast uses")
  confirms file-import reachability — not a symbol-level call-graph re-query — is the intended
  design. **Direction matters:** `file_edges` is `fromFile imports toFile`; "reachable FROM the
  changed files" = things that transitively IMPORT them ⇒ walk `toFile → fromFile` (reverse),
  seeded at the changed files. The direct 1-hop `callers[]` array is left exactly as today.
- **The `BlastRadius` contract has NO `degraded`/`reason` field** — unlike `BlastResult` (which
  does, following `repo-intel/types.ts`'s documented "DEGRADED CONTRACT" convention). Since
  `BlastRadius` is the LLM/`PrBrief`-composable domain shape, don't dirty it with transport-only
  observability fields. The route's actual response schema is a **local `.extend()`** of the
  vendored contract (`BlastRadius.extend({ degraded, degraded_reason })`), not a vendored-file
  edit. See §1.A.
- **`risk_brief` (`FeatureModelId`) already exists but is a DIFFERENT feature** ("Assesses merge
  risks for a pull request" — the `Risks`/`risks` section of `PrBrief`, someone else's future
  spec). Do not repurpose it for the optional blast summary — register a new `'blast_summary'`
  id instead, defaulted to a cheap/flash model. (`review_intent`'s original default was
  `openai/gpt-4.1` and had to be corrected to a flash model after the fact per `server/insights.md`
  — don't repeat that mistake by defaulting a new feature to a non-flash model.)
- **Client data only through `lib/hooks/*` → `lib/api.ts`** (never `fetch` in a component); all
  components use **named exports**; co-locate `Component.tsx` + `styles.ts` + `index.ts` per
  folder (`client/insights.md`). Every new user-facing string is a `next-intl` key — no hardcoded
  copy (client/insights.md flags several pre-existing violations; don't add another).
- **No graph-visualization library is installed** (`client/package.json` has no d3/reactflow/
  visx/dagre/cytoscape). The Graph view is genuinely new UI surface, not a config toggle on an
  existing component — §1.B scopes it as a small hand-rolled SVG layout to avoid adding a new
  dependency for one view, consistent with this repo's "no new packages" bias seen in
  `smart-diff.md` §2.

---

## 1. Module breakdown (dependency order: repo-intel → blast → client)

### 1.A `server/` — repo-intel 2-hop extension + new `blast/` module

**Create `server/src/modules/repo-intel/blast-reachability.ts`** (pure domain — no I/O, no Drizzle,
no Fastify — so the 2-hop walk is hermetically unit-testable without Postgres, which the sandbox
can't run anyway; see Gotchas):

- `reverseReachableFiles(edges: { fromFile: string; toFile: string }[], seeds: string[], depth:
  number, cap: number): Map<string, Set<string>>` — for each seed file, the set of files that
  **transitively import it** within `depth` hops. Build reverse adjacency `toFile → [fromFile]`
  once, then BFS from each seed; exclude the seed itself; stop at `depth` hops; globally cap the
  total number of visited files at `cap` (bounds cost on a pathological graph — a mild DoS guard,
  flagged in the DoD). Deterministic, order-stable. Takes precomputed `edges` so the caller does
  exactly one `getEdges` read.

**Modify `server/src/modules/repo-intel/constants.ts`** — add
`export const MAX_REACHABLE_FILES = 500;` (documented as "blast 2-hop reverse-reachability visited
cap"). Reuse the existing `BFS_DEPTH = 2` for the depth (do NOT add a new depth constant — the
brief's "2 levels deep" IS `BFS_DEPTH`, finally used on the blast path it was named for).

**Modify `server/src/modules/repo-intel/service.ts`** (inside `tryPersistentBlast`, `:315-391`
ONLY — the ripgrep/degraded fallback at `:220-304` stays byte-for-byte untouched) — after the
existing hop-1 `callers`/`factsByFile` computation, add 2-hop endpoint/cron reachability attributed
per changed symbol:

1. Hop 1 is unchanged: direct `callers` (from `getResolvedCallers(repoId, changedFiles,
   [...nameSet])`), the `MAX_CALLERS_PER_SYMBOL` cap on that array, and per-caller-file `factsByFile`.
2. **Hop 2 (reverse-import reachability):** read the graph once —
   `const edges = await this.repo.getEdges(repoId)` — then
   `const reachable = reverseReachableFiles(edges, changedFiles, BFS_DEPTH, MAX_REACHABLE_FILES)`.
   `reachable.get(changedFile)` is the set of files that transitively import that changed file
   within 2 hops.
3. Fetch `file_facts` for the UNION of all reachable files across all seeds in ONE
   `getFileFacts(repoId, [...allReachable])` call, into a `factsByFile`-style lookup (one
   round-trip, not N).
4. Build two new maps **keyed by changed-symbol name** — `endpointsBySymbol: Record<string,
   string[]>` and `cronsBySymbol: Record<string, string[]>`. For each changed symbol, union
   (deduped, sorted) the endpoints/crons of (a) its direct hop-1 caller files (from the existing
   `factsByFile`) and (b) every file reachable from the symbol's **declaring file**
   (`reachable.get(symbol.file)`) — i.e. everything that transitively imports the file the symbol
   lives in. (Per-declaring-file attribution: symbols sharing a changed file share the reachable
   set — a deliberate, cheap approximation; see §5.)
5. Fold the reachable endpoints into the flat `impactedEndpoints` union too, so it becomes the full
   1-hop-caller ∪ 2-hop-reachable set (an honest "everything this could touch").
6. **Important design decision:** the 2-hop walk extends endpoint/cron ATTRIBUTION only. It does
   **not** add rows to the visible `callers[]` array — that stays hop-1-only (direct callers,
   `MAX_CALLERS_PER_SYMBOL` per symbol, matching the design mock's "4 callers" next to "3
   endpoints": more endpoints than the 4 direct-caller files alone would explain, which is exactly
   what the 2-hop walk surfaces).
7. **Per-symbol caller cap (brief-alignment fix).** Today the final `callers.slice(0,
   MAX_CALLERS_PER_SYMBOL)` (line 386) caps 20 **total** across all symbols; the brief and the
   constant's own doc-comment (`constants.ts:29`, "caller fan-out cap per changed symbol") mean 20
   **per symbol**. Change it: group `callers` by `viaSymbol`, sort each group by `rank` desc, take
   the top `MAX_CALLERS_PER_SYMBOL` per group, flatten. This is the only change to caller
   selection; it is safe because `getBlastRadius` has zero other consumers today (grep-confirmed).

> **Degraded honesty (do NOT over-flag):** when `getEdges` returns `[]` (a `partial` index without
> the T3 graph), `reverseReachableFiles` yields empty sets, `endpointsBySymbol`/`cronsBySymbol`
> fall back to hop-1 facts only, and the result is unchanged from today's 1-hop behavior. That is a
> legitimate thin-but-not-`degraded:true` state — do NOT set `degraded:true` just because the graph
> is absent. `degraded` stays reserved for the index-unusable case that already sets it.

**Modify `server/src/modules/repo-intel/types.ts`** — add two **optional** fields to
`BlastResult` (`:74-87`): `endpointsBySymbol?: Record<string, string[]>` and `cronsBySymbol?:
Record<string, string[]>`. Optional so the ripgrep/degraded fallback path (`:220-304`, left
untouched) can omit them — the fallback stays 1-hop, same as it is today.

**Create `server/src/modules/blast/helpers.ts`** (pure, no I/O — mirrors `smart-diff/helpers.ts`):

- `toBlastRadius(result: BlastResult): BlastRadius`:
  - `changed_symbols = result.changedSymbols.map(s => ({ name: s.name, file: s.file, kind: s.kind }))`.
  - `downstream = changed_symbols.map(cs => ({ symbol: cs.name, callers:
    result.callers.filter(c => c.viaSymbol === cs.name).map(c => ({ name: c.symbol, file: c.file,
    line: c.line })), endpoints_affected: result.endpointsBySymbol?.[cs.name] ?? [],
    crons_affected: result.cronsBySymbol?.[cs.name] ?? [] }))`.
  - `summary: ''` — always empty from this pure mapper; only the optional summarize route (§1.A
    below) ever fills it, and only via `upsert`/return, never inside this deterministic mapper.
- `EMPTY_BLAST_RADIUS: BlastRadius = { changed_symbols: [], downstream: [], summary: '' }` — the
  "no data" shape, reused by the service for a PR with zero `pr_files` or zero parseable symbols.

**Create `server/src/modules/blast/service.ts`** — `BlastService` (mirrors `IntentService`'s
constructor/DI; no LLM dependency in the core path):

- `constructor(container)` → `this.repo = new ReviewRepository(container.db)`.
- `async get(workspaceId, prId): Promise<BlastRadius & { degraded?: boolean; degraded_reason?:
  string | null }>`:
  1. `pull = await this.repo.getPull(workspaceId, prId)` → `NotFoundError` if absent (A01
     workspace ownership, same guard as `IntentService.get`/`SmartDiffService.get`).
  2. `files = await this.repo.getPrFiles(prId)`; if empty, return `EMPTY_BLAST_RADIUS` (no
     `degraded` flag — this is a genuine "nothing changed here" case, not an index problem).
  3. `result = await this.container.repoIntel.getBlastRadius(pull.repoId,
     files.map(f => f.path))`.
  4. `const radius = toBlastRadius(result)`.
  5. `return { ...radius, ...(result.degraded != null ? { degraded: result.degraded,
     degraded_reason: result.reason ?? null } : {}) }`.
- **Optional, separable — `async summarize(workspaceId, prId, logger?)`:** re-fetches the same
  way, then (only if `changed_symbols.length > 0`) calls
  `resolveFeatureModelForRepo(container, workspaceId, pull.repoId, 'blast_summary')` +
  `container.llm(provider).completeStructured(...)` with a minimal schema (`z.object({ summary:
  z.string() })`) prompted with the already-computed `downstream` list (NOT raw code — the map
  itself is the only input, keeping the call cheap and deterministic-ish). Returns `{ ...radius,
  summary: llmSummary }`. **This step is NOT persisted anywhere and NOT called by `get()`** — it
  is a separate, manually-triggered route (mirrors `IntentService.recalculate`'s "never runs
  automatically" rule). If skipped entirely, delete this method and its route — nothing else in
  the plan depends on it.

**Create `server/src/modules/blast/routes.ts`** (Fastify plugin,
`fastify-type-provider-zod`, mirrors `intent/routes.ts`):

```
GET  /pulls/:id/blast            → BlastRadiusResponse   (always: zero LLM calls)
POST /pulls/:id/blast/summarize  → BlastRadiusResponse   (OPTIONAL — one LLM call; rate-limited like /intent/recalculate; implement only if the optional step is in scope)
```

- `const BlastRadiusResponse = BlastRadius.extend({ degraded: z.boolean().optional(),
  degraded_reason: z.string().nullish() });` declared locally in this file — **not** a vendored
  contract edit (see Gotchas above).
- `schema: { params: IdParams, response: { 200: BlastRadiusResponse } }` for both routes; the
  POST route additionally gets `config: { rateLimit: { max: 10, timeWindow: '1 minute' } }`
  (only if implemented — copy `intent/routes.ts`'s recalculate rate limit exactly).
- Handlers: `getContext` for `workspaceId`, delegate to `new BlastService(app.container)`.

**Modify `server/src/modules/index.ts`:** one import (`import blast from './blast/routes.js';`)
+ one entry (`blast`) in the `modules` registry object.

**If the optional summary step is implemented, also modify**
`server/src/vendor/shared/contracts/platform.ts` **and its client mirror** — add `'blast_summary'`
to the `FeatureModelId` enum and one `FEATURE_MODELS` entry: `{ id: 'blast_summary', label:
'Blast Radius Summary', description: 'One-paragraph summary of a PR's blast radius map.',
defaultProvider: 'openrouter', defaultModel: 'deepseek/deepseek-v4-flash' }` (flash-class default
from the start — see Gotchas above). Mirror both `platform.ts` copies AND
`client/src/lib/feature-models.ts` (the client renders `FEATURE_MODELS` from there, not from the
vendored copy — `server/insights.md`).

### 1.B `client/` — hook, compact card, full Blast tab (Tree + Graph), tab wiring, click-to-code

**Modify `client/src/lib/types.ts`:** add `BlastRadius` to the existing re-export line
(`export type { PrBrief, SmartDiff, Intent, BlastRadius } from "@devdigest/shared";`). Locally
extend it for the degraded fields where needed (`type BlastRadiusResult = BlastRadius & {
degraded?: boolean; degraded_reason?: string | null }`) — client doesn't runtime-validate
responses (confirmed: `lib/api.ts` callers use plain TS generics, no zod parse), so this is a
type-only addition, no schema duplication.

**Create `client/src/lib/hooks/blast.ts`** (mirrors `hooks/intent.ts`):

```ts
export function usePrBlast(prId: string | null) {
  return useQuery({
    queryKey: ["pr-blast", prId],
    queryFn: () => api.get<BlastRadiusResult>(`/pulls/${prId}/blast`),
    enabled: !!prId,
  });
}
// Only if the optional summary step is implemented:
export function useSummarizeBlast(prId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<BlastRadiusResult>(`/pulls/${prId}/blast/summarize`),
    onSuccess: (data) => qc.setQueryData(["pr-blast", prId], data),
  });
}
```

**Modify `client/src/lib/hooks/index.ts`:** add `export * from "./blast";`.

**Create `client/src/app/repos/[repoId]/pulls/[number]/_components/BlastRadiusCard/`**
(co-location: `BlastRadiusCard.tsx` + `styles.ts` + `index.ts`, mirrors `IntentCard/`):

- Props `{ prId: string | null; repoId: string; onOpenInDiff: (file: string, line: number | null)
  => void }` — same `onOpenInDiff` signature `FindingsTab` already receives from `page.tsx`.
- `usePrBlast(prId)`. States, in order of precedence: loading skeleton → `degraded` badge
  (`t("blast.degradedBadge", { reason })`, still renders whatever data IS present underneath,
  per requirement 4 — never a blank screen for a partial index) → empty state
  (`changed_symbols.length === 0`, `t("blast.empty")`) → the Tree-only compact view: for each
  `downstream[]` entry, a collapsible row (`symbol` + caller count + endpoint/cron count) that
  expands to a short caller list (`name` + clickable `file:line` calling `onOpenInDiff`), and
  endpoint/cron chips. This compact card is intentionally **Tree only** — the Graph view lives in
  the full tab (§ below), not duplicated here.
- A `"See full map →"` link (`Button kind="ghost"`) that sets `?tab=blast` (via the same
  `setTab`/`setParam` pattern `page.tsx` already exposes) instead of duplicating tab-switch logic
  in this component.

**Modify `client/src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/OverviewTab.tsx`:**
render `<BlastRadiusCard prId={prId} repoId={repoId} onOpenInDiff={onOpenInDiff} />` under
`<IntentCard .../>`. `OverviewTab`'s props need a new `onOpenInDiff` passthrough from `page.tsx`
(currently `OverviewTab` only receives `prBody`/`prId`/`repoId` — add the fourth prop).

**Create `client/src/app/repos/[repoId]/pulls/[number]/_components/BlastTab/`** (new tab,
co-location: `BlastTab.tsx` + `styles.ts` + `index.ts`, structurally mirrors `FindingsTab.tsx`'s
role as a tab-body component receiving `onOpenInDiff` from `page.tsx`):

- Same `usePrBlast(prId)` data source as the card (TanStack Query cache is shared — no double
  fetch).
- A `Tree | Graph` segmented toggle (local `useState<"tree" | "graph">("tree")`, default Tree —
  matches the "Tree is the primary/required view" product decision).
- **Tree view:** the same levels as the card but NOT truncated — full caller lists (still capped
  server-side at `MAX_CALLERS_PER_SYMBOL`), full endpoint/cron lists, "Prior PRs touching these
  files" section left **out of scope** (§6 — no data source for it was found in this research;
  flag as a follow-up, don't fabricate it).
- **Graph view (new component, `_components/BlastGraph/`):** a small hand-rolled SVG node-link
  diagram — no new dependency (see Gotchas). Layout: changed symbols as center nodes (one column),
  their callers as a second column to one side, distinct endpoint/cron nodes as a third column;
  straight-line edges; click a caller node → same `onOpenInDiff`. A **fixed, deterministic**
  column-based layout (not a physics/force simulation) keeps this genuinely simple — do not reach
  for a force-directed layout algorithm for a bounded, shallow graph (≤20 callers/symbol × a
  handful of symbols).
- Degraded/empty states: same precedence as the card.

**Modify `client/src/app/repos/[repoId]/pulls/[number]/_components/PrDetailHeader/
PrDetailHeader.tsx`:** add one entry to the `tabs` array (`:115-119`): `{ key: "blast", label:
"Blast", icon: "Zap" }` (or another `@devdigest/ui` icon already in the registry — verify against
its icon list, don't assume `Zap` exists without checking, matching the client's own precedent of
verifying `Icon.Circle` didn't exist before substituting `Icon.Dot`, per `client/insights.md`).
No count badge needed (unlike `findings`/`diff`, blast has no natural "count" the header already
knows without fetching).

**Modify `client/src/app/repos/[repoId]/pulls/[number]/page.tsx`:**
- Pass `onOpenInDiff={openInDiff}` into `<OverviewTab .../>` (new prop, per above).
- Add `{tab === "blast" && <BlastTab prId={prId} onOpenInDiff={openInDiff} />}` alongside the
  existing `overview`/`findings`/`diff` branches (`:147-186`).
- No new invalidation needed in `onRunDone` — blast radius is diff-derived, not
  review-run-derived; a completed review does not change which symbols/callers/endpoints exist.

**Modify `client/messages/en/prReview.json`:** add a `"blast": {…}` block sibling to the existing
`"intent": {…}` block (`:111-124`) — `label`, `empty`, `degradedBadge` (ICU `{reason}`),
`tree`/`graph` toggle labels, `callers`/`endpoints`/`crons` section labels, `seeFullMap`. If the
optional summarize step ships, also `summarize`/`summarizing`/`summarizeError` (mirrors
`intent.recalculate*`).

---

## 2. Dependency changes

- **New packages:** none (Graph view is hand-rolled SVG — see Gotchas).
- **DB migrations:** none — `blast/` reads existing `pr_files` via `ReviewRepository`, and
  `repo-intel`'s existing `symbols`/`references`/`file_rank`/`file_facts`/`file_edges` tables. The
  `tryPersistentBlast` extension (§1.A) is a new *query pattern* (one extra `getEdges` read, fanned
  out through the pure `reverseReachableFiles` helper and `getFileFacts`), not a new table or
  column.
- **Env vars:** none beyond what `REPO_INTEL_ENABLED` / LLM provider keys already require (the
  optional summarize step reuses the existing `resolveFeatureModelForRepo` + `container.llm(...)`
  machinery — no new secret).
- **Vendored `@devdigest/shared`:** `BlastRadius`/`DownstreamImpact`/`BlastCaller`/
  `ChangedSymbol` are unchanged — this feature only consumes them. **If and only if** the optional
  summary step ships, `FeatureModelId`/`FEATURE_MODELS` in `platform.ts` gain one new entry
  (`'blast_summary'`) — hand-mirror both vendored copies plus `client/src/lib/feature-models.ts`
  (three files, per `server/insights.md`'s vendoring gotcha).

---

## 3. Execution order (disjoint file ownership per step → parallel-safe)

**Step 1 — server: repo-intel 2-hop reachability extension** (no deps; touches shared infra, so it
goes first and alone)
Owns:
- `server/src/modules/repo-intel/blast-reachability.ts` (pure reverse-BFS helper)
- `server/src/modules/repo-intel/blast-reachability.test.ts` (hermetic — plain `.test.ts`, no PG)
- `server/src/modules/repo-intel/constants.ts` (only the new `MAX_REACHABLE_FILES`)
- `server/src/modules/repo-intel/service.ts` (only the `tryPersistentBlast` method body)
- `server/src/modules/repo-intel/types.ts` (only the two new optional `BlastResult` fields)
Test: `cd server && pnpm typecheck` + existing repo-intel unit tests must still pass
(`pnpm exec vitest run --exclude '**/*.it.test.ts'`). Unit-test `reverseReachableFiles` directly:
a 1-hop importer and a 2-hop importer of a seed are both returned; a 3-hop importer is NOT (depth
capped at `BFS_DEPTH`); the seed itself is excluded; empty edges → empty sets; the global
`MAX_REACHABLE_FILES` cap is honored. Then assert (by reading `tryPersistentBlast`): a route
handler reachable only via a wrapper (2 hops) surfaces in `endpointsBySymbol`; a changed symbol
with a direct caller that has no endpoint yields an empty array (no false positives); `callers[]`
is now capped **per `viaSymbol`** (20 each, not 20 total); and the ripgrep/degraded fallback path
(`:220-304`) is byte-for-byte unchanged (still 1-hop, still no `endpointsBySymbol`/`cronsBySymbol`).

**Step 2 — server: `blast/` module (pure mapper)** (depends on Step 1's `BlastResult` shape)
Owns:
- `server/src/modules/blast/helpers.ts`
- `server/src/modules/blast/helpers.test.ts` (hermetic — plain `.test.ts`, no PG)
Test: `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'` + `pnpm typecheck`.
Table-driven `toBlastRadius`: groups `callers` by `viaSymbol` correctly; a symbol with zero
callers still gets a `downstream` entry with empty arrays (not omitted); `endpoints_affected`/
`crons_affected` pull from `endpointsBySymbol`/`cronsBySymbol` with `?? []` fallback when those
fields are absent (degraded/fallback `BlastResult`); `summary` is always `''`; `EMPTY_BLAST_RADIUS`
round-trips through `BlastRadius.parse(...)` cleanly.

**Step 3 — server: service + routes + registration** (depends on Step 2)
Owns:
- `server/src/modules/blast/service.ts`
- `server/src/modules/blast/routes.ts`
- `server/src/modules/index.ts`
- `server/src/modules/blast/routes.it.test.ts` (real PG → `.it.test.ts` suffix per `TESTING.md`)
Test: `cd server && pnpm typecheck && pnpm exec vitest run .it.test`. Seed an indexed repo with a
changed shared helper, ≥2 direct callers, ≥1 of which is 2 hops from a route handler; assert
`GET /pulls/:id/blast` (a) validates against `BlastRadiusResponse`, (b) `downstream[].callers`
has exactly the direct callers (not the hop-2 one), (c) `endpoints_affected` includes the route
found only via hop 2, (d) `degraded`/`degraded_reason` pass through when repo-intel returns them,
(e) a PR with zero `pr_files` returns `EMPTY_BLAST_RADIUS` with no `degraded` flag, (f) 404s for a
PR outside the workspace. **If the optional summarize route is implemented**, also assert it
persists nothing (repeat `GET` afterward still returns `summary: ''`) and is rate-limited.

**Step 4 — client: `usePrBlast` hook + type re-export** (depends on Step 3 for the live contract
shape; buildable in parallel with Step 5 against the known contract)
Owns:
- `client/src/lib/types.ts`
- `client/src/lib/hooks/blast.ts`
- `client/src/lib/hooks/index.ts`
Test: `cd client && pnpm typecheck && pnpm test`. Hook test mocking `fetch` (jsdom): resolves the
grouped payload; `enabled:false` when `prId` is null.

**Step 5 — client: `BlastRadiusCard`** (independent of Step 4 — takes `prId`/`onOpenInDiff` via
props like every sibling card; depends only on the `BlastRadius` type existing)
Owns:
- `client/src/app/repos/[repoId]/pulls/[number]/_components/BlastRadiusCard/BlastRadiusCard.tsx`
- `.../BlastRadiusCard/styles.ts`
- `.../BlastRadiusCard/index.ts`
- `.../BlastRadiusCard/BlastRadiusCard.test.tsx`
- `client/messages/en/prReview.json` (only the new `"blast"` block)
Test: `cd client && pnpm typecheck && pnpm test`. RTL: loading skeleton → data render; degraded
badge shows with the reason when `degraded:true`; empty state when `changed_symbols` is empty;
clicking a caller's `file:line` calls `onOpenInDiff` with the right args.

**Step 6 — client: `BlastTab` + `BlastGraph`** (depends on Step 4's hook; independent of Step 5's
card — separate files, same data source)
Owns:
- `client/src/app/repos/[repoId]/pulls/[number]/_components/BlastTab/BlastTab.tsx`
- `.../BlastTab/styles.ts`
- `.../BlastTab/index.ts`
- `.../BlastTab/BlastTab.test.tsx`
- `.../BlastTab/_components/BlastGraph/BlastGraph.tsx`
- `.../BlastTab/_components/BlastGraph/styles.ts`
- `.../BlastTab/_components/BlastGraph/index.ts`
Test: `cd client && pnpm typecheck && pnpm test`. RTL over `BlastTab`: Tree/Graph toggle switches
rendered content; Tree view shows full (untruncated) caller/endpoint lists; a caller click in
either view calls `onOpenInDiff`. `BlastGraph` gets a lightweight snapshot/structure test (nodes
count matches `downstream` length + total callers + distinct endpoints — full pixel-layout
assertions are out of scope for RTL/jsdom).

**Step 7 — client: page + header wiring** (depends on Steps 5 and 6)
Owns:
- `client/src/app/repos/[repoId]/pulls/[number]/page.tsx`
- `.../OverviewTab/OverviewTab.tsx`
- `.../PrDetailHeader/PrDetailHeader.tsx`
Test: `cd client && pnpm typecheck && pnpm test`. RTL over `page.tsx` (or an existing page-level
test if one exists): `?tab=blast` renders `BlastTab`; the `PrDetailHeader` tab list includes
"Blast"; `OverviewTab` renders `BlastRadiusCard` below `IntentCard` and forwards `onOpenInDiff`.

**Step 8 — OPTIONAL, independently skippable: LLM summary step** (depends on Step 3's service
shape; do not block Steps 4-7 on this)
Owns:
- `server/src/vendor/shared/contracts/platform.ts` (new `blast_summary` `FeatureModelId` entry)
- `client/src/vendor/shared/contracts/platform.ts` (mirrored)
- `client/src/lib/feature-models.ts` (mirrored — this is the copy the UI actually renders from)
- `server/src/modules/blast/service.ts` → add `summarize()` (extends Step 3's file, so this step
  must land AFTER Step 3, not in parallel with it)
- `server/src/modules/blast/routes.ts` → add the `POST .../summarize` route (same file/ordering
  note)
- `client/src/lib/hooks/blast.ts` → add `useSummarizeBlast` (extends Step 4's file — lands after
  Step 4)
- A "Summarize" button + `summary` paragraph render in `BlastRadiusCard`/`BlastTab` (extends
  Steps 5/6's files — lands after them)
Test: `cd server && pnpm typecheck` + the `.it.test.ts` from Step 3 gains one more assertion
(summarize call returns a non-empty `summary`, is rate-limited, never auto-triggered by `GET`).
`cd client && pnpm typecheck && pnpm test` for the button's loading/error states.

**Parallelizable clusters:** Server is sequential `1 → 2 → 3` (Step 8 forks off Step 3, does not
block it). Client: **Steps 4 and 5 run in parallel**; Step 6 depends only on Step 4; Step 7 waits
on 5 and 6. Step 8 (if in scope) is a final, fully optional pass that can ship in a follow-up PR
without touching anything else.

---

## 4. Definition of Done (whole feature)

Typecheck / tests:
- [ ] `cd server && pnpm typecheck` and `pnpm test` (unit + the new `routes.it.test.ts`).
- [ ] `cd client && pnpm typecheck && pnpm test`.
- [ ] No `pnpm db:generate` diff expected (no schema change) — if one appears, something was
      touched that shouldn't have been.

Behavioral / requirement coverage (mapped to the brief's acceptance criteria):
- [ ] On a demo PR that changes a shared helper, `GET /pulls/:id/blast` returns ≥2 callers and
      ≥1 endpoint for that symbol (brief's literal acceptance bar), sourced from the real index,
      not fabricated.
- [ ] Clicking a caller's `file:line` (in both the compact card and the full tab, Tree and Graph)
      opens the code at that exact line via the existing `onOpenInDiff` mechanism — no new
      deep-link mechanism was invented.
- [ ] Response is reasonably fast — the persistent path is pure Postgres reads (one extra
      `getEdges` read + a capped in-memory reverse-BFS for hop 2), no clone parsing, no LLM.
- [ ] **Zero LLM calls** in `GET /pulls/:id/blast` (grep the module confirms no `container.llm` /
      `completeStructured` usage in `service.ts::get` or `helpers.ts`) — or exactly one, only via
      the separate, manually-triggered `POST .../summarize`, only if Step 8 shipped.
- [ ] A partial/degraded index renders a visible badge with the reason — never a blank screen —
      while still showing whatever data the persistent or fallback path DID produce.
- [ ] A PR with no relevant symbols (or no `pr_files`) renders an explicit empty state, not a
      crash or a silently blank card/tab.
- [ ] The 2-hop endpoint/cron reachability extension is verified against a fixture where the only
      import path from a changed file to a route-handler file is via an intermediate file (i.e.
      genuinely exercises hop 2 of the `file_edges` reverse walk, not just hop 1).
- [ ] i18n: all new user-facing strings are `next-intl` keys under `prReview.blast.*`; no new
      hardcoded copy.

Edge cases:
- [ ] Repo never indexed (`getIndexState` → `no_data`): `getBlastRadius` degrades per its
      existing contract; the UI shows the degraded badge, not an error boundary.
- [ ] A changed symbol with zero callers still appears in `downstream[]` (empty `callers`/
      `endpoints_affected`/`crons_affected` arrays, not omitted from the list).
- [ ] Two changed symbols declared in the same changed file share the same reachable-endpoint set
      (file-scoped attribution, documented behavior — not a bug, see §5).
- [ ] `MAX_CALLERS_PER_SYMBOL` caps the visible `callers[]` array **per `viaSymbol`** (20 each, not
      20 total across the whole response — a fix to today's existing over-aggressive global cap,
      §1.A step 7); `MAX_REACHABLE_FILES` + `BFS_DEPTH` bound the hop-2 reachability walk, so a
      highly-connected file can't blow up the query.

---

## 5. Risks and assumptions

- **Hop-2 endpoint attribution is file-import-graph-based (via `file_edges`/`getEdges`), not
  call-graph-based (via `references`/`getResolvedCallers`).** This follows the `fileEdges` schema
  comment's own documented intent ("the reverse-lookup index is what blast uses") rather than a
  symbol-level call-graph re-query — see §1.A. The tradeoff: the walk is **file-scoped**, so a
  changed symbol inherits every endpoint/cron reachable from its *declaring file*, even ones
  logically unrelated to that specific symbol if the file exports several things unrelated to each
  other. This favors recall over precision for a "what could this break?" map, and is bounded by
  `MAX_REACHABLE_FILES` + `BFS_DEPTH`. If this over-attributes too aggressively in practice (a
  large barrel file with many unrelated exports), a follow-up could narrow it to only the exports
  actually re-exported/used by the reachable file — out of scope here.
- **Hop depth is hardcoded to 2** (matches the brief exactly). Not configurable; if a future
  requirement wants deeper traversal, `tryPersistentBlast`'s new block is a straightforward loop
  to generalize, but doing so now would be speculative scope.
- **The `BlastRadiusResponse` extends `BlastRadius` at the route layer instead of editing the
  vendored contract.** This deliberately diverges from `smart-diff.md`'s "fits the existing shape
  exactly, no extension" precedent, because `BlastRadius` (unlike `SmartDiff`) genuinely needs a
  transport-only degraded flag the domain contract doesn't carry. If `BlastRadius` is later reused
  for `PrBrief` composition (its original apparent purpose), the extension fields simply won't be
  part of that document — no conflict.
- **Graph view is a fixed column layout, not a force-directed simulation.** Chosen to avoid a new
  dependency and because the data is shallow/bounded (≤20 callers/symbol, a handful of changed
  symbols) — a physics layout would be over-engineering for this shape. Revisit only if user
  feedback specifically wants free-form graph exploration.
- **The design mock's "Prior PRs touching these files" section has no identified data source** in
  this codebase (not part of `repoIntel.*`, not part of `PrHistory`/`pr_history` scaffolding found
  during research) — explicitly out of scope (§6), not silently dropped.
- **Assumption:** `ReviewRepository.getPull`/`.getPrFiles` behave identically to their use in
  `IntentService`/`SmartDiffService` (confirmed by reading both call sites) — no new repository
  method needed for `blast/service.ts`.

---

## 6. Out of scope (explicit — do not silently attempt or drop)

- **No changes to the ripgrep/clone-parsing fallback path** in `getBlastRadius` (`service.ts:
  220-304`) — stays 1-hop, stays `degraded:true`, exactly as today.
- **No symbol-level call-graph re-query for hop 2** (no second `getResolvedCallers` call) — hop-2
  reachability is `file_edges`-based only (§1.A, §5).
- **No persistence of the blast map or its optional summary** — every `GET` recomputes from the
  live index (cheap, pure reads); there is no `blast_cache`/`pr_blast` table, unlike
  `repo_map_cache`.
- **No automatic triggering of the optional summarize step** — it is manual-only, mirrors
  `IntentService.recalculate`'s explicit "never runs automatically" rule.
- **No "Prior PRs touching these files" section** — no data source identified (§5); a genuine
  follow-up, not a corner cut.
- **No reuse of the `risk_brief` `FeatureModelId`** for the optional summary — a new
  `blast_summary` id is registered instead (§1.A Gotchas).
- **No force-directed / physics graph layout, no new npm dependency for visualization.**
- **No `reviewer-core` changes** — blast radius never enters the diff→prompt→LLM review engine.
- **No DB schema / migration changes.**
