# Spec: Blast Radius — decorator-based route detection (NestJS) + method-level attribution

**Status:** planning
**Scope:** `server/` only (repo-intel indexer + blast facade). No client changes — the
`BlastRadius` contract (`endpoints_affected: string[]` per changed symbol) is unchanged; only
what populates it gets more accurate.

**Relationship to prior work:** this is a bug-fix spec, not a new feature. It closes a gap found
while diagnosing a real demo PR (NestJS monorepo) where Blast Radius correctly resolved callers
but showed `0 endpoints` — see `server/insights.md`'s "What Doesn't Work" entry ("extractEndpoints
only recognizes Express/Fastify..."), dated this session, for the full root-cause trace. Read that
entry first; this spec is the fix for it.

---

## 0. What already exists (do not touch / do not recreate)

Read from the codebase, not assumed.

| Artifact | State | Location |
|---|---|---|
| `extractSymbols(content)` | Works. Line-based regex extractor with class/brace-depth tracking (bare + `Class.method` dual-emit). Reused as the model for the new decorator scanner — do not reimplement brace tracking from scratch. | `server/src/adapters/codeindex/extract.ts:78-120` |
| `extractEndpoints(content)` | Works correctly for THIS project's own Fastify convention (`app.get(...)`, `router.post(...)`, `{method,url}` object). Structurally blind to decorator-based routing — no bug in what it does, just missing what it doesn't. Keep as-is; add alongside, don't rewrite. | `extract.ts:182-195`, tested `server/test/extract.test.ts:80-91` |
| `extractCrons(content)` | Unrelated, unaffected by this spec. | `extract.ts:202-214` |
| `file_facts` table | `(repo_id, file_path)` PK, `endpoints jsonb default([])`, `crons jsonb default([])`. FILE-scoped only — no per-symbol/method column today. | `server/src/db/schema/repo-intel.ts:75-88` |
| `IndexerFileFactsRow` | `{filePath, endpoints: string[], crons: string[]}` — the write-side shape the pipeline builds and `replaceFileFacts`/`upsertFileFacts` persist. | `server/src/modules/repo-intel/repository.ts:99-103` |
| `pipeline/full.ts` fact collection | Calls `extractEndpoints(source)`/`extractCrons(source)` per file during a full index pass, pushes into `factsBuf`, one row per file with ≥1 fact. | `server/src/modules/repo-intel/pipeline/full.ts:184-189` |
| `pipeline/incremental.ts` | Same fact extraction, incremental variant — confirm before editing whether it duplicates or calls into `full.ts`'s logic (read the file; don't assume). | `server/src/modules/repo-intel/pipeline/incremental.ts` |
| `tryPersistentBlast` endpoint attribution | Unions `factsByFile[caller.file].endpoints` (hop-1, keyed by the WHOLE file) and `factsByFile[reachableFile].endpoints` (hop-2, file-level reverse-import reachability) per changed symbol. Hop-1 already knows the exact enclosing caller symbol (`c.symbol` on each `BlastCallerRow`) but currently throws that specificity away by reading the whole file's flat `endpoints` array. | `server/src/modules/repo-intel/service.ts:415-442` |
| `BlastCallerRow` | `{file, symbol, viaSymbol, line, rank}` — `symbol` is the enclosing function/method name at the call site, already resolved. This is the hook H2 attaches to. | `server/src/modules/repo-intel/types.ts` (confirm exact location before editing) |
| `getFileFacts(repoId, files)` | Reads `{filePath, endpoints, crons}` per file — no method-level column to select yet. | `server/src/modules/repo-intel/repository.ts:534-543` |

**Two independent phases, do them in order — H2 depends on H1's output shape but H1 alone is a
complete, shippable fix on its own (matches the "0 endpoints" bug exactly):**

- **H1 — decorator-aware route extraction.** Without this, NestJS (or any other decorator-routed
  framework) contributes ZERO endpoint facts, full stop. This is the actual bug from the demo PR.
- **H2 — method-level attribution for hop-1 callers.** Without this, once H1 ships, a controller
  file with N unrelated `@Get`/`@Post` handlers will over-attribute ALL N routes to any changed
  symbol reached by ANY of them — a real but lower-severity precision problem, not a "shows
  nothing" problem. Hop-2 (reverse-import reachability) stays file-scoped by design — see §6.

---

## 1. Module breakdown

### 1.A `extract.ts` — H1: `extractNestRoutes`

**New function**, alongside `extractEndpoints`/`extractCrons`, same file
(`server/src/adapters/codeindex/extract.ts`). Do NOT fold this into `extractSymbols` — keep the
existing function's return shape (`ExtractedSymbol[]`) untouched; every other caller of
`extractSymbols` doesn't need route data and shouldn't pay for it.

```ts
export interface ExtractedRoute {
  route: string;       // "GET /portfolio/allocation"
  methodName: string;  // "getAllocation" — the bare symbol name, matches ExtractedSymbol.name
  line: number;
}

export function extractNestRoutes(content: string): ExtractedRoute[]
```

Implementation, reusing `extractSymbols`'s brace/class-tracking pattern (don't invent a second
state machine):
1. Track `@Controller(...)` on a class the same way `extractSymbols` tracks `currentClass` —
   when a line matches `/@Controller\s*\(\s*(?:['"\`]([^'"\`]*)['"\`])?\s*\)/`, capture group 1 as
   `controllerPrefix` (empty string if the decorator has no argument), reset when the class body
   closes (mirror the existing `classDepth`/`braceDepth` logic exactly).
2. Inside that class body, scan backwards from each method declaration (reuse `METHOD_RE`) for an
   immediately-preceding run of decorator lines (`^\s*@\w+`) — NestJS allows stacked decorators
   (`@UseGuards(...)` above `@Get(...)` above the method), so "immediately preceding" means
   "walk upward over consecutive `@...` lines, blank lines, and comment lines until a non-decorator
   line is hit" — a small bounded backward scan (cap at ~10 lines), not a full re-parse.
3. Among that decorator run, match `/@(Get|Post|Put|Patch|Delete|All)\s*\(\s*(?:['"\`]([^'"\`]*)['"\`])?\s*\)/`
   — group 1 is the HTTP verb (`All` maps to... decide: either skip `@All` (ambiguous verb, low
   value) or emit it as `ALL /path`; skipping is simpler and matches `extractEndpoints`'s existing
   verb allowlist, which also has no catch-all — **skip `@All`, document the decision inline**.
   Group 2 is the method-level path segment (empty string if bare `@Get()`).
4. Join `controllerPrefix` + method path with exactly one `/` (normalize double/missing slashes —
   `joinRoutePath(prefix, sub)` helper, handle both empty-segment cases and a leading `/` on either
   half). Emit `{route: "VERB /joined/path", methodName: <the method's bare name from METHOD_RE>,
   line: <method's line>}`.
5. A class with `@Controller` but a method with no HTTP-verb decorator (a plain helper method)
   emits nothing for that method — correct, it's not a route.

**Test additions** (`server/test/extract.test.ts`, extend the existing `describe('extractEndpoints
/ extractCrons')` block or add a sibling `describe('extractNestRoutes')`):
- Basic case: `@Controller('portfolio')` + `@Get('allocation')` on a method → `GET
  /portfolio/allocation`, correct `methodName`.
- No controller prefix (`@Controller()` or omitted) → path is just the method-level path.
- Stacked decorators (`@UseGuards(JwtAuthGuard)` then `@Get()` then method) → still detected.
- Multiple methods in one controller, only some decorated → only the decorated ones emit routes,
  correctly keyed by their own `methodName`.
- A plain (non-`@Controller`) class with a method matching `METHOD_RE` → emits nothing (regression
  guard against false positives leaking from unrelated classes).
- Reuse the exact NestJS source snippet from the demo PR's `portfolio.controller.ts` shape as one
  fixture (real-world regression case, not just synthetic).

### 1.B `pipeline/full.ts` + `pipeline/incremental.ts` — wire H1 into fact collection

At the same point `extractEndpoints`/`extractCrons` are called per file (`full.ts:184-189` and
wherever `incremental.ts` mirrors it), also call `extractNestRoutes(source)`. Two things get
built from the result:
1. **Backward-compatible flat list**: append `route` for every entry into the SAME `endpoints`
   array already being built — this alone ships H1's fix (NestJS routes now show up in
   `impactedEndpoints`, file-scoped, same precision `extractEndpoints`'s output always had).
2. **Method-level map for H2** (see §1.C for the schema this needs): build
   `routeSymbols: Record<string, string[]>` (`methodName → route[]`, an array because a bare
   `@Get()`/`@Post()` pair on two differently-decorated methods sharing a name inside the same
   file is theoretically possible, however unlikely — keep it an array for safety, don't assume
   1:1) alongside the existing `endpoints`/`crons` fields on the row pushed to `factsBuf`.

Confirm `incremental.ts`'s fact-collection code path independently before editing — per
`server/insights.md`'s existing note that `full.ts` and `incremental.ts` sometimes diverge in
subtle ways; don't assume a shared helper exists, read both files first.

### 1.C `db/schema/repo-intel.ts` + migration — new `route_symbols` column

Add one nullable jsonb column to `file_facts`:

```ts
routeSymbols: jsonb('route_symbols').notNull().default({}),
```

Shape: `Record<string /* bare method/symbol name */, string[] /* routes that symbol's decorator(s)
declare */>`. `.notNull().default({})` (not `.nullable()`) — matches the existing
`endpoints`/`crons` columns' own `.notNull().default([])` convention on the same table, and every
row this pipeline writes always supplies at least `{}`. Generate the migration with `pnpm
db:generate` (current latest is `0013_nasty_magus.sql` — do NOT hand-number a `0014_*.sql` file
yourself; let drizzle-kit name it, per `AGENTS.md`'s "Do NOT touch migrations" rule about
hand-editing, which is about EXISTING files, not about running the generator for a real new
column). Verify the generated SQL is a single `ALTER TABLE file_facts ADD COLUMN route_symbols
jsonb NOT NULL DEFAULT '{}'` — if `db:generate` proposes anything else (unrelated table changes),
stop and check for stale-snapshot drift per the `0011`/`0012` incident already documented in
`server/insights.md` before proceeding.

### 1.D `repository.ts` — extend read/write paths

- `IndexerFileFactsRow` (`repository.ts:99-103`): add `routeSymbols: Record<string, string[]>`.
- `replaceFileFacts`/`upsertFileFacts` (`:371-382`, `:599-615`): include `routeSymbols` in the
  `values` insert — currently only maps `endpoints`/`crons`, needs the third field added
  symmetrically in both write paths (full replace AND incremental upsert — don't fix only one,
  same class of bug as the `agent_runs`-write-signature-declared-twice gotcha already in
  `server/insights.md`).
- `getFileFacts` (`:534-543`): add `routeSymbols: t.fileFacts.routeSymbols` to the selected
  columns and to `IndexerFileFactsRow`'s return shape.

### 1.E `repo-intel/service.ts` — H2: method-scoped hop-1 attribution

In `tryPersistentBlast`'s endpoint-attribution loop (`service.ts:420-442`), change the hop-1 half
ONLY (hop-2/reachable-files stays file-scoped, see §6):

```ts
// BEFORE (file-scoped, over-attributes):
for (const c of cappedCallers) {
  if (c.viaSymbol !== sym.name) continue;
  const f = factsByFile[c.file];
  if (!f) continue;
  for (const e of f.endpoints) eps.add(e);
  ...
}

// AFTER (method-scoped where we have the data, file-scoped fallback otherwise):
for (const c of cappedCallers) {
  if (c.viaSymbol !== sym.name) continue;
  const f = factsByFile[c.file];
  if (!f) continue;
  const owned = f.routeSymbols?.[c.symbol];
  if (owned && owned.length > 0) {
    for (const e of owned) eps.add(e);       // precise: only THIS caller method's routes
  } else {
    for (const e of f.endpoints) eps.add(e); // fallback: non-NestJS files, or a caller that
  }                                           // isn't itself a decorated handler (e.g. a plain
  ...                                         // service method one hop below the controller)
}
```

The fallback branch matters: most hop-1 callers of a shared util are SERVICE methods, not
controller methods (as in the demo PR — `transactions.service.ts`/`portfolio.service.ts` call the
pagination helper directly, the controllers are hop-2 via the service). A service method has no
entry in `routeSymbols` (it's not `@Get`-decorated), so it correctly falls through to the file's
flat `endpoints` — which, for a plain service file, is `[]` anyway (services don't declare
routes), so this fallback is a no-op there and only matters for files that mix decorated and
undecorated methods.

### 1.F `types.ts` — extend `factsByFile` typing

`factsByFile: Record<string, { endpoints: string[]; crons: string[] }>` (`service.ts:410-413`)
needs `routeSymbols?: Record<string, string[]>` added to match. Update wherever this shape is
declared as a type (`types.ts` or inline in `service.ts` — check both).

---

## 2. Dependency changes

- **New packages:** none. Still pure regex/line-based, consistent with the rest of `extract.ts`
  (the module's own doc comment already explains why tree-sitter was deliberately deferred — this
  spec doesn't revisit that decision).
- **DB migration:** one new column (`file_facts.route_symbols`), §1.C. No new table.

---

## 3. Execution order (disjoint file ownership per step → parallel-safe)

1. **Step 1 (H1 core):** `extract.ts` (`extractNestRoutes` + `joinRoutePath` helper) +
   `test/extract.test.ts` (new cases). Fully independent, no DB, ships as a standalone hermetic
   unit — could merge alone as a partial fix if H2 needs more time.
2. **Step 2 (H1 wiring):** `db/schema/repo-intel.ts` (new column) → run `pnpm db:generate` → new
   migration file. Depends on nothing but must land before Step 3.
3. **Step 3 (H1 wiring, depends on Step 1 + Step 2):** `pipeline/full.ts`, `pipeline/incremental.ts`,
   `repository.ts` (`IndexerFileFactsRow`, `replaceFileFacts`, `upsertFileFacts`, `getFileFacts`).
   At the end of this step, `impactedEndpoints` already reflects NestJS routes — **H1 is
   feature-complete and independently testable here**, even before Step 4.
4. **Step 4 (H2, depends on Step 3):** `repo-intel/types.ts` (`factsByFile` typing) +
   `repo-intel/service.ts` (`tryPersistentBlast` attribution loop). Requires `routeSymbols` to
   actually be populated (Step 3) to have anything to read.
5. **Step 5 (verification, depends on Step 4):** `server/test/repo-intel-blast-2hop.test.ts` and/or
   a new `server/test/repo-intel-blast-nest.test.ts` — extend or add hermetic tests asserting: (a)
   a NestJS-shaped fixture produces a non-empty `impactedEndpoints`, (b) a controller with two
   unrelated `@Get` handlers only attributes the ONE route whose handler actually calls the changed
   symbol (the precision case H2 exists for), not both.

---

## 4. Definition of Done

- [ ] `extractNestRoutes` implemented, exported, unit-tested (≥5 cases per §1.A) — all green.
- [ ] `pnpm db:generate` produces exactly one new column on `file_facts`; `pnpm db:migrate` applies
      cleanly against a fresh DB.
- [ ] `pipeline/full.ts` AND `pipeline/incremental.ts` both populate `routeSymbols` (verified by
      reading both, not assumed from one).
- [ ] `repository.ts`'s three touch points (`IndexerFileFactsRow`, both write paths, `getFileFacts`)
      all carry `routeSymbols` symmetrically.
- [ ] `tryPersistentBlast` hop-1 attribution prefers `routeSymbols[caller.symbol]`, falls back to
      the file's flat `endpoints` when absent.
- [ ] Re-running the ORIGINAL minimal repro from `server/insights.md` (a `@Controller`/`@Get`
      source string through `extractEndpoints` directly) is superseded — the new assertion is that
      `extractNestRoutes` on that same string returns the route; `extractEndpoints` itself is
      intentionally left unchanged (§0) so its existing tests keep passing unmodified.
- [ ] `pnpm typecheck` and `pnpm test` (unit) clean in `server/`.
- [ ] `.it.test.ts` additions (if any touch real Postgres) are written and typecheck even if they
      can't execute in this sandbox (per the testcontainers limitation already noted in
      `server/insights.md`'s Tool & Library Notes).
- [ ] Manually verified against the actual demo PR (or an equivalent local NestJS fixture repo) via
      `POST /repos/:id/resync` → `GET /pulls/:id/blast` — `impactedEndpoints` is non-empty and the
      over-attribution case from H2 is confirmed fixed by inspecting `endpoints_affected` on two
      symbols known to reach the SAME controller file via DIFFERENT handler methods.

---

## 5. Risks and assumptions

- **Regex-based decorator detection is inherently approximate** (same tradeoff `extract.ts`'s doc
  comment already accepts for the rest of the module) — multi-line decorator argument lists (a
  `@Get({ path: '...', ... })` spanning several lines) won't be caught by the single-line verb
  regex in step 3 of §1.A. Acceptable for this spec (matches existing precision elsewhere in the
  file); flag as a known limitation in the PR description, don't silently over-promise coverage.
- **`@All()` is deliberately skipped** (§1.A step 3) — if it turns out to matter in practice, adding
  it later is a one-line regex change, not a design change.
- **Hop-2 stays file-scoped** — H2 only tightens hop-1 (direct callers). A changed symbol whose
  ONLY path to an endpoint is via 2+ hops still gets file-level (over-)attribution from whichever
  reachable file has ANY route. This is a known, accepted imprecision — see §6.
- **`routeSymbols` fallback correctness depends on `c.symbol` matching `METHOD_RE`'s captured
  name exactly** — if `extractNestRoutes`'s method-name capture and `extractSymbols`'s/
  `getResolvedCallers`'s enclosing-symbol resolution ever diverge in naming (e.g. one includes
  `Class.method`, the other bare `method`), the lookup silently misses and falls back to file-level
  — not a crash, but a silent precision regression. Worth a cross-check test asserting both
  extractors agree on the SAME method's name for the SAME source line.

---

## 6. Out of scope (explicit — do not silently attempt or drop)

- **Hop-2 method-level attribution.** The reverse-import BFS (`blast-reachability.ts`) only knows
  "file A transitively imports file B," never which specific function in A does the importing for
  what purpose — there is no caller-symbol data at that hop to key `routeSymbols` off of. Making
  hop-2 precise would require walking the actual call graph two levels deep (superseding the
  file-edges-based design that was already a deliberate architectural choice — see
  `server/insights.md`'s "2026-07-09 correction" entry on why `reverseReachableFiles` was chosen
  over a second `getResolvedCallers` call). Not attempted here.
- **Express/Fastify sub-router mounting** (`app.use('/api', subRouter)` path-prefix composition)
  is also out of scope — `extractEndpoints` itself is unchanged (§0), not extended by this spec.
- **Extending `extractEndpoints` to also understand NestJS** was considered and rejected — keeping
  `extractNestRoutes` separate (§1.A) means each function stays a single, readable regex pass
  scoped to one convention, instead of one function accreting `if (looksLikeNest) ... else if
  (looksLikeFastify) ...` branches.
- **Client-side changes.** `BlastRadius`/`endpoints_affected` contract shape is unchanged; the
  client already renders whatever `impactedEndpoints`/`endpoints_affected` contains. Nothing to do
  in `client/`.
