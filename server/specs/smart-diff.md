# Spec: Smart Diff

**Status:** planning
**Scope:** `server/`, `client/` (one combined spec, owned by `server/`, mirroring the
cross-cutting `server/specs/intent-layer.md` / `server/specs/skills.md` convention. It also
covers client-side work — hooks + the Files-changed viewer.)

Reorder/group a PR's changed files by review risk so a reviewer's eye lands on business logic
first, not lockfiles. Three groups, rendered in this order: **`core`** (business logic) →
**`wiring`** (config/index/glue) → **`boilerplate`** (lockfiles, dist, snapshots, generated).
A new `GET /pulls/:id/smart-diff` endpoint **deterministically composes data that already
exists** — the PR's `prFiles` (path/additions/deletions/patch) and the findings from the most
recent completed review — into the pre-existing `SmartDiff` contract. **No LLM call happens at
this step.** The client adds a "Smart order / Original order" toggle to the Files-changed tab
that switches between the new grouped view and today's flat diff.

---

## 0. What already exists (do not touch / do not recreate)

| Artifact | State | Location (file:line) |
|---|---|---|
| `SmartDiff` / `SmartDiffGroup` / `SmartDiffFile` / `SmartDiffRole` / `ProposedSplit` zod contracts | ✅ exists (both vendored copies, identical) | `server/src/vendor/shared/contracts/brief.ts:80-113` · `client/src/vendor/shared/contracts/brief.ts:80-113` |
| `SmartDiff` type re-exported for the client | ✅ already exported | `client/src/lib/types.ts` (`export type { PrBrief, SmartDiff, Intent }`) |
| `PrFile` contract `{ path, additions, deletions, patch }` | ✅ exists | `server/src/vendor/shared/contracts/platform.ts:204-210` |
| `Finding` contract `{ id, severity, category, title, file, start_line, end_line, … }` | ✅ exists | `server/src/vendor/shared/contracts/findings.ts:47-63` |
| `GET /pulls/:id` → `prFiles` (path/additions/deletions/patch), reads `pr_files` | ✅ exists | `server/src/modules/pulls/routes.ts:229`; schema `server/src/db/schema/pulls.ts:36-45` |
| `GET /pulls/:id/reviews` → persisted reviews + findings | ✅ exists | `server/src/modules/reviews/routes.ts:129` |
| "Latest review per PR" precedent (newest-first, take first per key, filter `kind='review'`) | ✅ exists — reuse these semantics | `server/src/modules/pulls/routes.ts:114-129` |
| `ReviewRepository` — `getPull(workspaceId, prId)` · `getPrFiles(prId)` · `reviewsForPull(prId)` | ✅ exists — smart-diff reuses ALL of these (no new repo) | `server/src/modules/reviews/repository.ts:30-65` |
| `IntentService` — the exact module template to mirror (news up `ReviewRepository` from `container.db`, pure `helpers.ts`, Zod routes) | ✅ reference | `server/src/modules/intent/{service,routes,helpers}.ts` |
| `DiffTab` (integration point) → `<DiffViewer files commenting />` | ✅ exists (no grouping/toggle) | `client/src/app/repos/[repoId]/pulls/[number]/_components/DiffTab/DiffTab.tsx` |
| `DiffViewer` (flat `.map()` of `PrFile[]` → `FileCard`) | ✅ exists — kept as the "Original order" view, unchanged | `client/src/components/diff-viewer/DiffViewer/DiffViewer.tsx` |
| `FileCard` / `CodeLine` (collapsible file + line rendering) | ✅ exists — reuse; extend with OPTIONAL props | `client/src/components/diff-viewer/FileCard/FileCard.tsx` · `.../CodeLine/CodeLine.tsx` |
| `parsePatch` / `HUNK_HEADER_RE` / `AUTO_EXPAND_MAX_LINES` | ✅ exists (diff-viewer `helpers.ts` / `constants.ts`) | `client/src/components/diff-viewer/{helpers,constants}.ts` |
| `useRunReview` / `usePrReviews` invalidation of `["reviews", prId]` on run complete | ✅ exists | `client/src/lib/hooks/reviews.ts` · `client/src/app/.../page.tsx:156-160` (`onRunDone`) |
| `messages/en/shell.json` → `diffViewer` namespace (`useTranslations("shell")`) | ✅ exists (`diffViewer` key at line 33) | `client/messages/en/shell.json` |

**Net-new work:** a `server/src/modules/smart-diff/` module (pure classifier + constants +
compose + service + routes), one line in `modules/index.ts`, a `useSmartDiff` client hook, a
`SmartDiffViewer` component (reusing `FileCard`/`CodeLine`), a findings badge + scroll-to-line
extension on `FileCard`/`CodeLine`, and the Smart/Original toggle in `DiffTab`.

### Gotchas baked in from insights (read once, apply throughout)

- **The `SmartDiff` contract is DO-NOT-TOUCH vendored code.** It already exists identically in
  both `server/src/vendor/shared` and `client/src/vendor/shared`. This feature **only consumes**
  it. No contract edit is planned — so, unlike the Intent Layer, there is **no hand-mirroring
  step** here. If a shape change ever became necessary it would require editing both copies by
  hand, but this spec deliberately fits the existing shape.
- **`pseudocode_summary` stays `null` for every file (confirmed with the user).** No producer
  exists anywhere in the repo (grep-verified). The screenshot's per-file "🪄 What this does"
  summaries and "🪄 summary" badges are **out of scope / future work** — see §6. The contract
  field is `.nullish()`, so the composer sets it explicitly to `null`.
- **`findings` has no `pr_id` column** (`server/insights.md`) — but smart-diff never queries
  `findings` directly. It reuses `ReviewRepository.reviewsForPull(prId)`, which already joins
  through `reviews`. Do **not** hand-write a findings-by-PR JOIN.
- **"Most recent completed review run" = the pulls-list precedent, not new logic** (user
  confirmed): reviews are newest-first (`reviewsForPull` orders `desc(createdAt)`); take the
  **first row whose `kind === 'review'`** and overlay ITS findings. A `reviews` row only exists
  after a review completes, so "newest `kind='review'` row" already means "most recent completed
  review". This mirrors `pulls/routes.ts:114-129` (which filters `kind='review'`).
- **reviewer-core is NOT touched.** Smart Diff is deterministic post-processing of two
  already-persisted things; it never enters the diff→prompt→LLM engine.
- **repo-intel `file_rank` percentile is NOT used here.** `repo-intel/service.ts:417` exposes a
  per-path "top-N%" percentile annotated "smart-diff / run-executor" — an available *future*
  risk signal, but this spec's classification is **deterministic path-based only** (§1.A). Do not
  pull repo-intel into scope.
- **Client i18n is enforced but frequently bypassed** (`client/insights.md`: `window.confirm`
  English strings, hardcoded `"Description"` header). Every new user-facing string in this
  feature MUST be a `next-intl` key under `shell.diffViewer.*`. Do not add another violation.
- **Client data only through `lib/hooks/*` → `lib/api.ts`** (never `fetch` in a component); all
  components use **named exports**; co-locate `Component.tsx` + `styles.ts` + `index.ts` per
  folder (`client/insights.md`). `SmartDiff` is already re-exported from `lib/types.ts` — import
  the type from there, not the vendored path.

---

## 1. Module breakdown (dependency order: server → client)

### 1.A `server/` — smart-diff module (onion: routes → service → pure helpers/constants)

`reviewer-core` depends on nothing here; `server` owns all backend logic; `client` consumes the
new route. Within the server module, dependencies point inward: `routes.ts` → `service.ts` →
`helpers.ts`/`constants.ts` (pure). `service.ts` MUST NOT import `drizzle-orm`/`db/schema`/
`fastify`; it goes through `ReviewRepository` (already the DB boundary). `helpers.ts`/
`constants.ts` are pure (no I/O) and unit-testable in isolation — mirrors `modules/intent/`.

**Create `server/src/modules/smart-diff/constants.ts`** (patterns + thresholds ONLY — kept apart
from logic so patterns can be tuned without touching classification code, per requirement 1):

- `BOILERPLATE_PATTERNS: RegExp[]` — matched against the full file path. Concrete defaults:
  - lockfiles: `/(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|npm-shrinkwrap\.json|bun\.lockb|composer\.lock|Gemfile\.lock|poetry\.lock|Pipfile\.lock|Cargo\.lock|go\.sum|flake\.lock)$/`
  - build/generated output dirs: `/(^|\/)(dist|build|out|coverage|\.next|node_modules|vendor)\//`
  - minified + source maps: `/\.min\.(js|css)$/`, `/\.map$/`
  - snapshots: `/(^|\/)__snapshots__\//`, `/\.snap$/`
  - generated markers: `/(^|\/)generated\//`, `/\.(generated|gen)\.[a-zA-Z]+$/`
  - drizzle snapshot meta: `/(^|\/)db\/migrations\/meta\//`
- `WIRING_PATTERNS: RegExp[]`:
  - `/(^|\/)package\.json$/`, `/(^|\/)tsconfig[^/]*\.json$/`
  - config files: `/(^|\/)[^/]*\.config\.(js|ts|mjs|cjs|json)$/`
  - dotfiles/tooling: `/(^|\/)\.(eslintrc|prettierrc|babelrc|editorconfig|gitignore|gitattributes|npmrc|nvmrc)/`
  - barrels/glue: `/(^|\/)index\.(ts|tsx|js|jsx)$/`
  - type declarations: `/\.d\.ts$/`
  - CI/containers: `/(^|\/)\.github\//`, `/(^|\/)Dockerfile$/`, `/(^|\/)docker-compose[^/]*\.ya?ml$/`
  - other yaml (CI/config-ish): `/\.ya?ml$/`
- `SPLIT_TOO_BIG_LINES = 400` — total changed lines above which the PR is "too big".
- `SPLIT_MIN_CORE_DIRS = 2` — minimum distinct top-level dirs among **core** files to suggest a
  by-directory split.

> **Security (ReDoS):** every pattern above is linear — no nested/adjacent unbounded quantifiers
> — so classifying attacker-influenced GitHub file paths cannot backtrack catastrophically. Keep
> any added pattern linear and anchored (`^`/`$`/`(^|\/)`). Flagged in the DoD.

**Create `server/src/modules/smart-diff/helpers.ts`** (pure domain — no I/O, unit-testable):

- `classifyFile(path: string): SmartDiffRole` — **precedence `boilerplate` → `wiring` → `core`**:
  return `'boilerplate'` if any `BOILERPLATE_PATTERNS` matches, else `'wiring'` if any
  `WIRING_PATTERNS` matches, else `'core'` (default). (Precedence matters: `dist/index.js`
  matches a boilerplate dir before the `index.*` wiring rule → correctly `boilerplate`;
  `package-lock.json` is a lockfile → `boilerplate` before `package.json`'s wiring rule, which is
  a different file anyway.) Path-only; the patch is not needed for classification.
- `findingLinesFor(path, findings): number[]` — from `findings` whose `file === path`, collect
  each finding's `start_line`, **dedupe + sort ascending**. (Decision: anchor on `start_line`
  only — one deduped line per finding location; `end_line` ranges are ignored to keep the badge
  count = distinct flagged lines. Flag this in §5.)
- `computeSplitSuggestion(files, coreFiles): { too_big, total_lines, proposed_splits }`:
  - `total_lines = Σ (additions + deletions)` over **all** files.
  - top-level dir of a path = first segment before `/`, or `'(root)'` when the path has no `/`.
  - `dirs = distinct top-level dirs among coreFiles`.
  - `too_big = total_lines > SPLIT_TOO_BIG_LINES && dirs.size >= SPLIT_MIN_CORE_DIRS`.
  - `proposed_splits = too_big ? [for each dir (sorted): { name: dir, files: coreFilePathsInDir (sorted) }] : []`.
- `buildSmartDiff(files, findings): SmartDiff` — the top-level composer:
  - `files: { path, additions, deletions }[]` (projected from `PrFile`), `findings: { file, start_line }[]`.
  - classify each file; build a `SmartDiffFile` = `{ path, pseudocode_summary: null, additions,
    deletions, finding_lines: findingLinesFor(path, findings) }`.
  - **Always emit exactly three groups, in fixed order `[core, wiring, boilerplate]`** (a group
    may have an empty `files` array — the client hides empties, but a stable 3-group shape keeps
    ordering deterministic and the response self-describing).
  - within each group, keep files in the input order (GitHub's diff order) — do NOT re-sort
    inside a group; only the grouping changes the reviewer's reading order.
  - `split_suggestion = computeSplitSuggestion(files, coreFiles)`.

**Create `server/src/modules/smart-diff/service.ts`** — `SmartDiffService` (mirrors
`IntentService`'s constructor/DI: news up `ReviewRepository` from `container.db`; no new repo):

- `constructor(container)` → `this.repo = new ReviewRepository(container.db)`.
- `get(workspaceId, prId): Promise<SmartDiff>`:
  1. `pull = await this.repo.getPull(workspaceId, prId)` → `NotFoundError('Pull request not
     found')` if absent (A01 workspace ownership — same guard as every other PR-scoped read).
  2. `files = await this.repo.getPrFiles(prId)` (may be empty).
  3. `reviews = await this.repo.reviewsForPull(prId)` (newest-first). Pick the most recent
     completed review: `latest = reviews.find(r => r.review.kind === 'review')`. `findings =
     latest ? latest.findings : []`.
  4. `return buildSmartDiff(files.map(f => ({ path: f.path, additions: f.additions, deletions:
     f.deletions })), findings.map(f => ({ file: f.file, start_line: f.startLine })))`.
     (`FindingRow` is camelCase: `startLine`; `PrFile` row exposes `path/additions/deletions`.)

**Create `server/src/modules/smart-diff/routes.ts`** — Fastify plugin (`fastify-type-provider-zod`):

```
GET /pulls/:id/smart-diff → SmartDiff
```
- `const app = appBase.withTypeProvider<ZodTypeProvider>();`
- Reuse `getContext(container, req)` for `workspaceId` and `IdParams` for `params` (both from
  `../_shared/`), exactly as `intent/routes.ts` does.
- `schema: { params: IdParams, response: { 200: SmartDiff } }` — the Zod response schema both
  validates and serializes; **do not** hand-roll `SmartDiff.parse` in the handler.
- Handler: `const { workspaceId } = await getContext(app.container, req); return new
  SmartDiffService(app.container).get(workspaceId, req.params.id);`
- Read-only, no mutation, no LLM → **no rate-limit config** needed (unlike `/review` and
  `/intent/recalculate`).

**Modify `server/src/modules/index.ts`:** one import (`import smartDiff from './smart-diff/
routes.js';`) + one entry (`smartDiff`) in the `modules` registry object. No other module changes.

### 1.B `client/` — hook, viewer, badge extension, toggle wiring

**Create `client/src/lib/hooks/smart-diff.ts`** (TanStack Query; all data via `lib/api.ts`):
```ts
export function useSmartDiff(prId: string | null | undefined) {
  return useQuery({
    queryKey: ["smart-diff", prId],
    queryFn: () => api.get<SmartDiff>(`/pulls/${prId}/smart-diff`),
    enabled: !!prId,
  });
}
```
- Import the `SmartDiff` type from `@/lib/types` (already re-exported) — not the vendored path.
- **Freshness after a review completes:** the `finding_lines` overlay changes only when a new
  review lands. That completion is already signalled in `page.tsx`'s `onRunDone` (which calls
  `refetchReviews` + invalidates `["reviews", prId]`). §1.B wiring adds a sibling
  `qc.invalidateQueries({ queryKey: ["smart-diff", prId] })` there (see the DiffTab-wiring step)
  — the hook itself needs no polling. Classification-only data (groups/order) is
  review-independent, so an unreviewed PR still returns a valid `SmartDiff` (empty
  `finding_lines`).

**Modify `client/src/lib/hooks/index.ts`:** add `export * from "./smart-diff";`.

**Create `client/src/components/diff-viewer/SmartDiffViewer/`** (co-location convention:
`SmartDiffViewer.tsx` + `styles.ts` + `index.ts`; named export):
- Props: `{ smartDiff: SmartDiff; files: PrFile[]; commenting?: DiffCommentApi }`.
- Build a `Map<path, PrFile>` from `files` (SmartDiffFile carries no `patch`; `FileCard` needs the
  `PrFile` to render lines). Skip (or render header-only) any smartDiff file with no matching
  `PrFile` — defensive; same source so it should always match.
- Optional `split_suggestion` banner at the top: when `smartDiff.split_suggestion.too_big`, show
  a subtle info banner — `t("diffViewer.smart.splitTooBig", { total })` plus the proposed split
  names (`proposed_splits.map(p => p.name)`). Non-blocking, purely advisory.
- Render the groups in the response order (`core → wiring → boilerplate`); **skip a group whose
  `files` array is empty**. Each group = a section header (role label via
  `t("diffViewer.smart.role.<role>")` + file count) and the list of `FileCard`s.
- **Collapse state per group:** local `useState`; `core` and `wiring` start **open**,
  `boilerplate` starts **collapsed** (requirement 4). Clicking the section header toggles it.
- For each `SmartDiffFile`, render `<FileCard file={prFile} commenting={commenting}
  findingLines={f.finding_lines} />` — reusing `FileCard`, passing the new optional prop.
- All strings via `next-intl` (namespace `shell`, keys under `diffViewer.smart.*`).

**Modify `client/src/components/diff-viewer/FileCard/FileCard.tsx`** — add an OPTIONAL
`findingLines?: number[]` prop (backward-compatible; existing `DiffViewer` callers pass nothing):
- When `findingLines?.length`, render a clickable "findings" badge in the header (reuse an
  `@devdigest/ui` primitive — e.g. an `Icon` + count chip; the header already renders a comment
  count chip to mirror). Label via `t("diffViewer.smart.findingsBadge", { count:
  findingLines.length })`.
- Badge `onClick` (stop propagation): `setOpen(true)`, then on the next frame
  (`requestAnimationFrame`) scroll to the first flagged line via
  `document.getElementById(lineAnchorId(file.path, findingLines[0]))?.scrollIntoView({ block:
  "center" })`. Opening-then-scrolling is required because the lines aren't in the DOM while
  collapsed.
- Pass a `Set<number>` of `findingLines` down to each `CodeLine` so flagged NEW-side lines get a
  highlight + a stable anchor id.

**Modify `client/src/components/diff-viewer/CodeLine/CodeLine.tsx`** — add an OPTIONAL
`highlightLines?: Set<number>` prop (backward-compatible):
- When the line is on the NEW side (`ln.newNo`) and `highlightLines?.has(ln.newNo)`, apply a
  subtle highlight style (a new `styles.ts` entry) and set `id={lineAnchorId(path, ln.newNo)}` on
  the row so `FileCard`'s badge can scroll to it.

**Modify `client/src/components/diff-viewer/helpers.ts`** — add a pure
`lineAnchorId(path: string, lineNo: number): string` (e.g. `` `smartdiff-${path}:${lineNo}` ``)
so `FileCard` (scroll target) and `CodeLine` (id) agree on the anchor. Backward-compatible append.

**Modify `client/src/components/diff-viewer/index.ts`** — add `export { SmartDiffViewer } from
"./SmartDiffViewer";` (public surface, alongside `DiffViewer`).

**Modify `client/src/components/diff-viewer/DiffTab/`… → actually the integration point is
`DiffTab.tsx`.** **Modify
`client/src/app/repos/[repoId]/pulls/[number]/_components/DiffTab/DiffTab.tsx`:**
- Call `const { data: smartDiff } = useSmartDiff(prId);`.
- Add local `const [order, setOrder] = React.useState<"smart" | "original">("smart");` — **default
  to Smart order** (the screenshot's "Reviewer-ordered diff" is the intended default; smart-diff
  is always available even with zero reviews).
- Add a Smart/Original toggle in the `SectionLabel` `right` slot (reuse `@devdigest/ui` `Button`
  group, mirroring the existing "Show/Hide comments" button pattern already in this file). Strings
  via `t("diffViewer.smart.orderSmart")` / `t("diffViewer.smart.orderOriginal")`.
- Body: `order === "smart" && smartDiff ? <SmartDiffViewer smartDiff={smartDiff} files={files}
  commenting={commenting} /> : <DiffViewer files={files} commenting={commenting} />`. Falls back
  to the flat `DiffViewer` while `smartDiff` is loading/undefined, so there is no empty state.
- Note: `DiffTab` currently hardcodes English literals (`"Files changed · … files"`,
  `"Show/Hide comments"`). Those pre-exist; convert the **new** strings to i18n (don't expand the
  existing violation, but wiring the new toggle through `t(...)` is required).

**Modify `client/src/app/repos/[repoId]/pulls/[number]/page.tsx`:** in the existing
`FindingsTab` `onRunDone` handler (currently `invalidateActiveRuns() + invalidateRunHistory() +
refetchReviews()`), add `qc.invalidateQueries({ queryKey: ["smart-diff", prId] })` so a completed
review refreshes the `finding_lines` overlay. One line; no other change to this file.

**Modify `client/messages/en/shell.json`** — under the existing `diffViewer` object add a `smart`
sub-object: `orderSmart`, `orderOriginal`, `role.core`, `role.wiring`, `role.boilerplate`,
`findingsBadge` (ICU `{count}`), `splitTooBig` (ICU `{total}`), and any section-header/count
copy. English values only (other locales out of scope, mirroring existing partial-locale state).

---

## 2. Dependency changes

- **New packages:** none.
- **DB migrations:** **none** — smart-diff reads existing `pr_files`, `reviews`, `findings`. No
  schema change, so **no `pnpm db:generate` / `pnpm db:migrate` runs at all**.
- **Env vars:** none.
- **Vendored `@devdigest/shared`:** **no change** — the `SmartDiff` family already exists
  identically in both copies. No hand-mirroring.
- **Contracts / types:** `SmartDiff` is already re-exported from `client/src/lib/types.ts` — no
  edit there either.

---

## 3. Execution order (disjoint file ownership per step → parallel-safe)

Each step lists the EXACT files it owns. No file appears in two steps.

**Step 1 — server: classifier constants + pure helpers/composer** (no deps)
Owns:
- `server/src/modules/smart-diff/constants.ts`
- `server/src/modules/smart-diff/helpers.ts`
- `server/src/modules/smart-diff/helpers.test.ts` (hermetic — no PG, so plain `.test.ts`)
Test: `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'` + `pnpm typecheck`.
Table-driven `classifyFile` over the pattern constants (lockfile/dist/snapshot → `boilerplate`;
`package.json`/`tsconfig.json`/`index.ts`/`*.config.ts`/`*.d.ts` → `wiring`; `src/foo.ts` →
`core`; precedence case `dist/index.js` → `boilerplate`). `findingLinesFor` dedupe/sort.
`computeSplitSuggestion`: below threshold → `too_big:false, proposed_splits:[]`; above threshold
with ≥2 core dirs → one split per dir. `buildSmartDiff`: exactly 3 groups in `core→wiring→
boilerplate` order; `pseudocode_summary === null` on every file; output parses against `SmartDiff`.

**Step 2 — server: service + routes** (depends on Step 1)
Owns:
- `server/src/modules/smart-diff/service.ts`
- `server/src/modules/smart-diff/routes.ts`
Test: `cd server && pnpm typecheck`. (Behavioral route test lands in Step 3, once registered.)

**Step 3 — server: register module + route integration test** (depends on Step 2)
Owns:
- `server/src/modules/index.ts`
- `server/src/modules/smart-diff/routes.it.test.ts` (real PG → `.it.test.ts` suffix per
  `TESTING.md`)
Test: `cd server && pnpm exec vitest run .it.test`. Seed a PR with `pr_files` across roles + one
completed `kind='review'` review with findings on a core file; assert `GET /pulls/:id/smart-diff`
(a) validates against `SmartDiff`, (b) groups `core→wiring→boilerplate` with the right files in
each, (c) `finding_lines` = the review's deduped/sorted start_lines on that file, (d) selects the
**newest** `kind='review'` when several reviews exist, (e) 404s for a PR outside the workspace.

**Step 4 — client: `useSmartDiff` hook** (depends on Steps 2-3 for the live API; buildable
against the contract in parallel with Step 5)
Owns:
- `client/src/lib/hooks/smart-diff.ts`
- `client/src/lib/hooks/index.ts`
Test: `cd client && pnpm typecheck && pnpm test`. Hook test mocking `fetch` (jsdom) — `useSmartDiff`
resolves the grouped payload; `enabled:false` when `prId` is null.

**Step 5 — client: `SmartDiffViewer` + `FileCard`/`CodeLine` badge extension** (independent of
Step 4 — takes data via props; depends only on the already-exported `SmartDiff` type)
Owns:
- `client/src/components/diff-viewer/SmartDiffViewer/SmartDiffViewer.tsx`
- `client/src/components/diff-viewer/SmartDiffViewer/styles.ts`
- `client/src/components/diff-viewer/SmartDiffViewer/index.ts`
- `client/src/components/diff-viewer/SmartDiffViewer/SmartDiffViewer.test.tsx`
- `client/src/components/diff-viewer/FileCard/FileCard.tsx`
- `client/src/components/diff-viewer/CodeLine/CodeLine.tsx`
- `client/src/components/diff-viewer/helpers.ts`
- `client/src/components/diff-viewer/index.ts`
- `client/messages/en/shell.json`
Test: `cd client && pnpm typecheck && pnpm test`. RTL over `SmartDiffViewer` with a mocked
`SmartDiff`: (a) sections render in `core→wiring→boilerplate` order; (b) the `boilerplate` section
is collapsed by default while `core`/`wiring` are open; (c) a file with `finding_lines` shows the
badge and clicking it opens the card (scroll is a no-op in jsdom — assert the card expands / the
anchor id is present); (d) empty groups are not rendered. Confirm existing `DiffViewer`/`DiffTab`
still typecheck (FileCard/CodeLine changes are additive/optional).

**Step 6 — client: DiffTab toggle + page invalidation** (depends on Steps 4 and 5)
Owns:
- `client/src/app/repos/[repoId]/pulls/[number]/_components/DiffTab/DiffTab.tsx`
- `client/src/app/repos/[repoId]/pulls/[number]/page.tsx`
Test: `cd client && pnpm typecheck && pnpm test`. RTL over `DiffTab`: default renders
`SmartDiffViewer` (Smart order); clicking "Original order" swaps to the flat `DiffViewer`; while
`useSmartDiff` is loading, the flat viewer renders (no crash). Mock `useSmartDiff`/`usePrComments`.

**Parallelizable clusters:** Server chain is sequential `1 → 2 → 3`. On the client, **Steps 4 and
5 run in parallel** (disjoint files, no cross-dep); Step 6 waits on both. The client cluster can
begin against the contract as soon as the route shape (Step 2) is fixed, and is fully verifiable
once Step 3 lands.

---

## 4. Definition of Done (whole feature)

Typecheck / tests:
- [ ] `cd server && pnpm typecheck` and `pnpm test` (unit + the new `routes.it.test.ts`).
- [ ] `cd client && pnpm typecheck && pnpm test`.
- [ ] No `pnpm db:generate` diff is expected (no schema change) — if one appears, something was
      touched that shouldn't have been.

Behavioral / requirement coverage:
- [ ] `GET /pulls/:id/smart-diff` returns a `SmartDiff` with exactly three groups in
      `core → wiring → boilerplate` order; classification matches the constants
      (lockfiles/dist/snapshots → `boilerplate`; config/index/`*.d.ts`/`package.json` → `wiring`;
      everything else → `core`).
- [ ] `pseudocode_summary` is `null` for **every** file (no LLM call anywhere in the path;
      grep the module confirms no `container.llm` / `completeStructured` usage).
- [ ] `finding_lines` per file = deduped, ascending `start_line`s of the **newest completed
      (`kind='review'`) review's** findings on that file; a PR with no reviews yields all-empty
      `finding_lines` and still returns valid groups.
- [ ] `split_suggestion.too_big` is `true` only when `total_lines > 400` AND ≥2 distinct
      top-level dirs among core files; `proposed_splits` groups core files by top-level dir; both
      are deterministic (no randomness, no LLM).
- [ ] Route is workspace-scoped (404 for a PR outside the caller's workspace, via `getPull`).
- [ ] Client Files-changed tab defaults to Smart order, renders the 3 sections with
      `boilerplate` collapsed by default, and a "Smart order / Original order" toggle swaps to the
      unchanged flat `DiffViewer`.
- [ ] A file with findings shows a findings badge that, on click, expands the `FileCard` and
      scrolls to the first flagged line (via the shared `lineAnchorId` anchor); flagged lines are
      visually highlighted. `FileCard`/`CodeLine` reused — no duplicated file-rendering logic.
- [ ] Completing a review invalidates `["smart-diff", prId]` so the badge/overlay refreshes
      without a reload.
- [ ] i18n: all new user-facing strings are `next-intl` keys under `shell.diffViewer.smart.*`;
      no new hardcoded copy.

Edge cases:
- [ ] Empty diff / no `pr_files`: all three groups empty; `split_suggestion.too_big:false`,
      `total_lines:0`, `proposed_splits:[]`; the client shows the flat viewer's "no changed
      files" empty state (Smart viewer renders nothing → toggle still works).
- [ ] A `SmartDiffFile` with no matching `PrFile` in the client list is skipped gracefully
      (defensive; should not occur since both come from `GET /pulls/:id`).
- [ ] Multiple reviews on a PR: only the newest `kind='review'` review's findings overlay
      (asserted in the it-test).
- [ ] Attacker-influenced file paths do not cause ReDoS — patterns are linear/anchored.

---

## 5. Risks and assumptions

- **"Latest review run" = single newest `kind='review'` review.** When a review batch fans out to
  several agents, each produces its own `reviews` row; there is no batch id linking them, so
  smart-diff overlays only the **single newest** review's findings (the literal reuse of the
  pulls-list "take first per PR" precedent the user confirmed). If the team later wants the union
  of all agents in the latest batch, that is a follow-up — the composer takes a plain `findings`
  list, so only the service's selection step (§1.A step 3) would change.
- **`finding_lines` anchors on `start_line` only.** Multi-line findings collapse to their start
  line, and the badge counts distinct flagged lines (not raw finding count — near-always 1:1).
  Chosen for a clean scroll anchor and a truthful badge; revisit if reviewers want the full
  `start_line..end_line` range highlighted.
- **Classification is heuristic and path-based.** The default patterns cover the common
  JS/TS/Python/Rust/Go ecosystems; unusual generated-file conventions may land in `core`. Because
  patterns live in a dedicated `constants.ts`, tuning is a one-file change with no logic edit —
  exactly the requirement-1 seam. `repo-intel`'s `file_rank` percentile is a richer future risk
  signal but is deliberately out of scope.
- **Split heuristic is intentionally simple** (total-lines threshold + distinct core dirs). It
  can over- or under-suggest on monorepos with deep nesting (only the top-level segment is used).
  It is advisory (a banner), never blocking, so a wrong suggestion is low-cost.
- **Assumption:** `ReviewRepository.reviewsForPull(prId)` returns rows newest-first with each
  review's `kind` and its `findings` (confirmed: `repository/review.repo.ts:57-74`), and
  `getPrFiles` returns `{ path, additions, deletions, patch }` rows (confirmed:
  `repository.ts:38`). No new repository method is needed.
- **Client-side, `FileCard`/`CodeLine` gain optional props.** These are shared by the flat
  `DiffViewer` too; the props are optional and default to today's behavior, so the flat view is
  byte-for-byte unchanged. Verified by keeping `DiffViewer.tsx` out of every step's file list.

---

## 6. Out of scope (explicit — do not silently attempt or drop)

- **No `pseudocode_summary` generation and no LLM call at this step.** `pseudocode_summary` is
  `null` for every file. The screenshot's per-file "🪄 What this does" summaries and "🪄 summary"
  badges are **future work** — no producer exists in the repo and none is planned here.
- **No changes to the `SmartDiff` / `SmartDiffGroup` / `SmartDiffFile` / `SmartDiffRole` /
  `ProposedSplit` contracts** or to either vendored `@devdigest/shared` copy. This feature fits
  the existing shape exactly.
- **No `reviewer-core` changes** — smart-diff never enters the review engine.
- **No DB schema / migration changes** — reads existing tables only.
- **No repo-intel `file_rank` / percentile integration** — deterministic path-based
  classification only.
- **No new "latest review" semantics** — reuse the existing pulls-list newest-`kind='review'`
  selection.
</content>
</invoke>