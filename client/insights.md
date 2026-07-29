# client — insights

> Durable, non-obvious learnings for `@devdigest/web` (Next.js studio UI, TanStack Query,
> vendored UI/contracts). Maintained via the `engineering-insights` skill: append-only,
> deduplicated, substance only. Read before working; empty sections are expected, not a bug.
> Cross-package facts go in the repo-root `insights.md`.

## What Works

- Co-location convention (component / constants.ts / helpers.ts / styles.ts / index.ts per folder) is consistently applied across all `_components` — follow this pattern for every new component without exception.
- All data fetching goes through `lib/hooks/` (TanStack Query) → `lib/api.ts`; no `fetch` calls inside components. This is enforced and working well.
- `lib/types.ts` acts as a re-export hub for `@devdigest/shared` contracts; always import types from there, not from the vendored shared path directly.
- `styles.ts` files use a typed `s` object (`as const`, `satisfies CSSProperties`) — the `s.headCell(alignRight)` factory function pattern keeps dynamic styles typed and co-located.
- `position: fixed` tooltips escape `overflow: hidden` ancestors without a React portal — the PR list table card uses `overflow: hidden` for border-radius clipping, but `position: fixed` is positioned relative to the viewport and is never clipped by parent overflow. Use `getBoundingClientRect()` on the trigger element to place the tooltip; set `pointerEvents: "none"` so it doesn't interfere with mouse-leave events.

## What Doesn't Work

- Deep relative imports (`../../../../../../../lib/hooks`) inside nested `_components` bypass the `@/` alias that is already configured. The alias works and is used in some files; the rest should be migrated. Seven-level paths are a DX hazard and break easily on file moves.
- `window.confirm` with hardcoded English strings (found in `PRDetailPage`'s delete-run handler) bypasses the next-intl i18n system. Any user-facing string must go through `t("...")`.
- `OverviewTab.tsx`'s existing `"Description"` section header (before the Intent Layer feature touched this file) is a hardcoded English literal passed as `<SectionLabel>` children — never `t("...")`. Pre-existing, not fixed when the Intent Card was added alongside it (out of scope for that change) — a third instance of the same i18n-bypass pattern already flagged above; don't assume a component is i18n-clean just because it uses `next-intl` elsewhere in the same tree.
- `setTimeout` without `clearTimeout` cleanup (found in `RunTraceDrawer.copyRaw`) can trigger state updates on unmounted components. Always pair `setTimeout` with a `useRef` + cleanup.
- Mocking a TanStack Query hook (e.g. `vi.mock("@/lib/hooks/smart-diff", () => ({ useSmartDiff: () => useSmartDiffMock() }))`) with a **module-level mutable `let` variable** that different `it()` blocks reassign, combined with `await import("./Component")` INSIDE each test, produces flaky "multiple elements found" failures — but only when the whole suite runs together, not in isolation (timing-dependent, not deterministic). Fix: use a static top-level `import { Component } from "./Component"` (mocks are hoisted, so this still respects `vi.mock`) plus a real `vi.fn()` whose return value is set per-test via `mockReturnValue(...)` and reset in `afterEach`. Mirrors the existing `RunReviewDropdown.test.tsx` pattern — follow it instead of dynamic `import()` + shared closures.

## Codebase Patterns

- `@/` path alias (`src/*`) is configured in tsconfig but inconsistently used: top-level `app/` files use it, deeply nested `_components` often fall back to relative paths. Convention: always use `@/` for anything outside the immediate component folder.
- Domain input types (`ActiveRun`, `CreateCommentInput`, `RunReviewInput`) are currently defined inside `lib/hooks/reviews.ts` rather than in `lib/types.ts`. This forces consumers to import types from the hook file. New domain types should land in `lib/types.ts`.
- All components use named exports (`export function X`) except `RunTraceDrawer` which uses `export default`. Inconsistency breaks barrel-file tooling. Prefer named exports throughout.
- `PRDetailPage` (`repos/[repoId]/pulls/[number]/page.tsx`) is a god page: 186 lines, 12+ hooks, inline invalidation helpers not extracted to a custom hook. It is the outlier — every other page is lean. Pattern to follow: extract per-page orchestration into a `usePrDetailPage()` hook.
- Page-level `styles.ts` is missing for `PRDetailPage` (and some `RunTraceDrawer/_components`), leaving inline `style={{...}}` objects in JSX that create new object references each render. All other pages have co-located `styles.ts`.
- Filter/sort logic in `PullsPage` (`pulls/page.tsx`) is inline in the component body; the sibling `helpers.ts` exists but only holds `sizeOf` and `relativeTime`. Pattern: filter/sort utilities belong in `helpers.ts`, not in the render function.
- `OPEN_STATUSES` set is defined at the top of `PullsPage` component instead of in `constants.ts`. Any module-level constant referenced only within one feature should live in that feature's `constants.ts`.

## Tool & Library Notes

- `SectionLabel` (`@devdigest/ui`) takes an optional `right?: React.ReactNode` slot (right-aligned via `marginLeft: "auto"`) for an inline header-level action — e.g. a "Recalculate" button next to a section title, no extra wrapper markup needed. Used by the Intent Card's `## Intent` header; check this prop before hand-rolling a flex row for "title + button" layouts.
- `@monaco-editor/react` (v4.7.0) is now installed in client/. Use dynamic import with `next/dynamic` and `ssr: false` — Monaco does not run server-side. Wrap in a loading placeholder to avoid layout shift.
- File upload to Fastify must use raw `fetch` + `FormData` (not `api.post`) because `api.post` sets `content-type: application/json`, which breaks multipart. The `useImportSkillFile` hook does this correctly; do not refactor it through `api`.
- `@dnd-kit/core` + `@dnd-kit/sortable` (v6/v10) are installed. Cross-list DnD pattern used in `SkillsTab`: left panel items use `useSortable` inside `SortableContext`; right panel items use `useDraggable`; left container uses `useDroppable`. Distinguish source in `onDragEnd` via `active.data.current.type`. Use `arrayMove` from `@dnd-kit/sortable` for reorder. Apply optimistic local state (`pendingOrder`) to avoid list snap-back during in-flight mutations — clear it once the server-derived sort matches. A `Set` built from a `useMemo`-derived array must be rebuilt *inside* a child `useMemo` (not passed as a dep) — a `new Set(...)` reference always changes, causing the child memo to re-run every render. Tab bodies that need full-height two-column layout must opt out of the editor's default `padding: 28 / overflow: auto` by overriding `s.body` styles conditionally in `AgentEditor`.
- `SeverityBadge` (from `@devdigest/ui`) accepts a `count` prop that renders an inline number alongside the icon — no wrapper or custom chip needed when you want "CRITICAL 3"-style counters.
- `src/vendor/ui/icons.tsx`'s `Icon` registry is a curated SUBSET of `lucide-react`, not the full library — e.g. no `Compass`, `Map`, or `BookOpen` exist even though lucide-react ships them. A `NavItemDef.icon` (or any `IconName`-typed prop) must pick from the existing registry; adding a new icon means editing `icons.tsx`, which is vendored (`Do NOT touch` per `client/AGENTS.md`) and typically outside a scoped step's file list — check the registry FIRST before picking an icon name in a plan/spec, rather than assuming any lucide-react name works.
- `MermaidDiagram` (`components/mermaid-diagram/MermaidDiagram.tsx`) does a lazy `await import("mermaid")` inside a `useEffect` and only paints after an async `mermaid.parse`/`mermaid.render` round-trip — RTL tests of a page that embeds it should `vi.mock("@/components/mermaid-diagram/MermaidDiagram", ...)` with a synchronous stub (e.g. `<div data-testid="mermaid-diagram">{chart}</div>`) rather than let the real async effect run; the real component's own behavior is out of scope for a page-level test anyway.

- **RTL `getByText("exact string")` fails on a line built from multiple sibling `{t(...)}` calls
  joined by literal `·` separators with no wrapping `<span>` per segment** — e.g. `{t("a")} ·{" "}
  {t("b")}` inside one `<div>`. Each `{t(...)}` call is its own text node, but since they're all
  direct children of the same element (no nested elements), that element's own normalized
  `textContent` IS the full concatenated line — so `getByText` still matches, but only against the
  **entire** joined string (`"2 symbols · 2 callers · 1 endpoint · 1 cron"`), never a substring
  segment alone (`getByText("2 symbols")` throws "text is broken up by multiple elements"). Assert
  on the whole rendered line, not per-segment substrings, unless you wrap each stat in its own
  element.

## Codebase Patterns (nav)

- **Sidebar `NavItem`s are NOT configured in `components/app-shell/`** — they live in the vendored
  `src/vendor/ui/nav.ts` (`NAV: NavGroup[]`), consumed by `vendor/ui/shell/Sidebar.tsx`.
  `components/app-shell/helpers.ts`'s `activeKeyFor()` only maps a pathname to a highlight key; it
  does not register the item itself, and `app-shell/constants.ts` has no nav-item list at all —
  there is no extension point on `ShellContext` for injecting extra nav items from the app side.
  A plan step whose file list says "modify app-shell nav (constants.ts + helpers.ts)" to add a new
  repo-scoped sidebar link is describing the wrong files if `activeKeyFor` already anticipates the
  route (it often does — this codebase pre-writes `activeKeyFor` branches ahead of the nav item
  existing). The actual one-line addition has to go in `vendor/ui/nav.ts`'s `NAV` array — treat
  this the same as vendored `shared` contracts (hand-edited in place per AGENTS.md's cross-cutting
  note), not as an off-limits third-party file, since `nav.ts` is first-party route/shortcut
  config, not a component implementation.

- **A confirmed instance of the above going wrong, not just being incomplete: `nav.ts`'s Eval
  Dashboard entry is `{ key: "eval-dashboard", ..., href: "/eval" }`, but `activeKeyFor()`
  (`app-shell/helpers.ts`) has `if (pathname.startsWith("/eval")) return "eval";` — a DIFFERENT
  key string.** Both exist today; neither is missing. The sidebar item can never highlight when
  a user is on any `/eval*` route, because `Sidebar.tsx` compares the NAV item's own `key` against
  whatever `activeKeyFor` returns, and `"eval-dashboard" !== "eval"`. No error, no console warning —
  the route works, the page renders, only the highlight silently never activates. ⇒ When a nav
  item and its `activeKeyFor` branch are both pre-written ahead of the page (the common pattern
  noted above), diff the exact key STRING on both sides, not just whether both exist — matching
  substrings (`"eval"` vs `"eval-dashboard"`) are exactly the kind of near-miss that passes a quick
  glance.

## Recurring Errors & Fixes

- **CSS var hardcoded fallback breaks dark mode**: `var(--token, #hardcoded-light-color)` silently renders the hex fallback in dark mode when `--token` is undefined. Always use another CSS variable as fallback (`var(--token, var(--other-token))`) or omit the fallback and define the token in the theme. Fixed: `var(--accent-subtle, #f0f7ff)` → `var(--accent-bg)` on the selected CandidateCard background.
- **List thrashing after TanStack Query refetch**: toggling any field (e.g. `enabled`) triggers a query invalidation + refetch; the server response can return rows in a different order, causing visible list jumps. Fix: always `[...list].sort((a, b) => a.name.localeCompare(b.name))` client-side before rendering — in `useMemo` for derived arrays, or inline in the `.map()` call. Apply this to every list whose order must be stable across refetches.
- **A `pendingOrder ?? serverOrder` optimistic-override effect (`if (pendingOrder && serverOrder.join(",") === pendingOrder.join(",")) setPendingOrder(null)`, the `SkillsTab`/`ContextTab` dnd-kit pattern) has a false-positive the instant you freeze `pendingOrder` to a value that equals the CURRENT (not-yet-refetched) `serverOrder`** — e.g. freezing on a checkbox toggle before its mutation's `onSuccess` invalidation has landed. On the very next render, `serverOrder` is still computed from the OLD, unchanged query data, so it trivially still equals the just-frozen `pendingOrder`, and the effect immediately clears the freeze — before the mutation (and whatever regroup/resort it would otherwise trigger) ever lands. Symptom: the override appears to do nothing. Fix: a one-shot `skipNextReconcileRef` set at freeze time, consumed (and reset) by the very next effect run, so only a *later*, genuine mismatch (once server data actually changed) is eligible to auto-clear. Used in `AgentEditor/_components/ContextTab/ContextTab.tsx`'s `handleToggle`. Also merge in any doc path present in the live data but missing from a frozen `pendingOrder` (e.g. newly discovered via re-index) rather than freezing the array outright — otherwise a permanently-frozen order silently hides new rows until reload.
- **React inline-style objects: mixing the `border` shorthand in a base style with the `borderColor` longhand in a state-conditional override loses the override on the way back out.** `DocListItem`'s `s.row` set `border: "1px solid transparent"` (shorthand) while `s.rowActive` set only `borderColor: "var(--accent)"` (longhand). Going inactive→active→inactive: React's inline-style diffing sees `border`'s *value* is unchanged between the active and inactive style objects (same string both times) so it never reapplies it, but it does clear `borderColor` (present in the active object, absent from the inactive one) by setting it to `''` — leaving `border-color` to fall back to the CSS initial value `currentColor` (the row's own text color), which renders as a stray light border that never resets to transparent. Symptom looked like "multiple rows stay selected" even though only one `active` boolean was ever true. Fix: use the longhand triplet (`borderWidth`/`borderStyle`/`borderColor`) in the base style instead of the `border` shorthand, so `borderColor` is always a real key in both states and gets correctly reapplied. `SkillsPage/styles.ts`'s equivalent `card`/`cardActive`/`cardInactive` already does this correctly (both `cardActive` and `cardInactive` define `borderColor` explicitly) — that's the pattern to copy, not `DocListItem`'s original one.
- **A markdown preview card with `maxWidth` but no `overflow-x` lets wide content (GFM tables, long `pre`/code blocks) visually spill past its rounded box into the raw page background** — `@devdigest/ui`'s `Markdown` component (`vendor/ui/primitives/Markdown.tsx`) has zero CSS for `table`/`th`/`td`/`pre` (no rule in `vendor/ui/styles.css` either), so a wide GFM table renders at its intrinsic content width regardless of an ancestor `maxWidth`, breaking out of the card visually instead of respecting it (looks broken, worse once the card's background was fixed to a dark-theme token since there's no longer a hardcoded white box to hide the overflow against). Since `vendor/ui/*` is off-limits (AGENTS.md "Do NOT touch"), fix at the call site: add `overflowX: "auto"` to the previewCard container (`ContextPage/styles.ts` and `SkillsPage/styles.ts` both needed it) so wide content scrolls within the card instead of leaking past it.
- **`MonoLink` (`@devdigest/ui`) button-mode doesn't stop propagation**: its `href` (anchor) branch calls `e.stopPropagation()` on click, but its `onClick` (button) branch does not. Nesting a `MonoLink` inside another clickable row/header (e.g. `FindingCard`'s expand-toggle header) means clicking it also bubbles up and fires the parent's handler. Fix: wrap it in `<span onClick={(e) => e.stopPropagation()}>` at the callsite — `MonoLink`'s own `onClick` prop signature is `() => void` (no event), so you can't stop propagation from inside the callback itself.
- 2026-07-15 addendum to the CSS-var-fallback entry above: the same `background: "var(--bg-canvas, #fff)"` + `color: "#111"` pair (hardcoded light card on a nonexistent `--bg-canvas` token — it's defined nowhere in `vendor/ui/styles.css`, so it *always* falls back to white regardless of theme) was independently copy-pasted into two `previewCard` style blocks: `repos/[repoId]/context/_components/ContextPage/styles.ts` (`DocPreview`, the Project Context markdown viewer) and `skills/_components/SkillsPage/styles.ts` (`PreviewTab`). Both fixed to `background: "var(--bg-elevated)"` / `color: "var(--text-primary)"`. Grep for `bg-canvas` before adding any new markdown/content preview card — it's a copy-paste trap, not a one-off.
- **A tab key present in an `EditorTab`/`TABS` array (e.g. `AgentEditor/constants.ts`) is not enough to make that tab reachable** — the parent page (`agents/[id]/page.tsx`) independently allowlists valid `?tab=` values in its own `VALID_TABS` array before trusting `searchParams`. `TABS` had `"context"` but `VALID_TABS` didn't: clicking the Context tab called `onTab("context")`, which wrote `?tab=context` to the URL, but the very next render's `VALID_TABS.includes(...)` check silently fell back to `"config"` — so the tab appeared in the bar and was clickable, but visibly snapped back to Config every time, with no error. Any new entry added to `TABS` must be mirrored into `page.tsx`'s `VALID_TABS`, or it's dead on arrival.

## Session Notes

- 2026-06-22: implemented per-severity aggregated counter strip on the PR findings tab with click-to-filter; state in `FindingsTab`, threaded through `ReviewRunAccordion` → `FindingsPanel` → `visibleFindings` (4 files, no new APIs or components).
- 2026-06-22: added FINDINGS column to PR list table — `COLUMN_KEYS` + `GRID` in `constants.ts` are the two places to update; `PRRow` renders compact `SeverityBadge` chips from `pr.findings_by_severity` (server-computed, new field on `PrMeta`).
- 2026-06-22: added hover tooltip to FINDINGS column — `position: fixed` card in `PRRow`, data via new `PrMeta.findings: PrFindingSummary[]` (capped at 10, sorted by severity server-side). `Icon.Circle` does not exist in the registry; use `Icon.Dot` instead.
- 2026-06-24: Full client/ architecture audit — identified 11 issues across import style, god-page pattern, type organization, i18n bypass, style consistency, and cleanup hygiene. No code changed; findings captured above.
- 2026-07-03: Fixed dark-mode CandidateCard selected state (hardcoded `#f0f7ff` fallback → `--accent-bg`). Wired `skill_count` through to `AgentCard` skillCount prop; badge hidden when count is 0 to avoid "0 skills" noise.
- 2026-06-24: Migrated 8 files from deep relative imports (7 levels) to @/ alias: FindingCard.tsx, FindingsPanel.tsx + test, RunReviewDropdown.tsx + test, SettingsApiKeys.tsx + constants.ts, SettingsModels.tsx. Task 1 of 11 completed; tasks 2-11 remain pending.
- 2026-07-05: Fixed `FindingCard`'s file:line link — was a `githubBlobUrl` deep-link opening a new GitHub tab; now calls `onOpenInDiff(file, line)` which the PR detail `page.tsx` wires to switch to the Files-changed tab and pass `targetFile/targetLine/targetNonce` down through `DiffTab` → `SmartDiffViewer`/`DiffViewer` → `FileCard` (forces the file open, expands its Smart Diff role section if collapsed, and scrolls to/highlights the line via the existing `lineAnchorId`/`highlightLines` mechanism, falling back to a new `fileCardId` anchor when the line isn't in the rendered patch). Removed the now-dead `githubBlobUrl`/`encPath` from `lib/github-urls.ts` (kept `githubPrUrl`). Verified end-to-end with `agent-browser` (see root insights.md) against real seeded PR #482 data — no new tab opens, URL's `tab` param flips to `diff`, target file card opens and scrolls into view.

- 2026-07-09: Blast Radius client implemented per `server/specs/blast-radius.md`: `lib/hooks/
  blast.ts` (`usePrBlast`, `useSummarizeBlast`), `BlastRadiusCard` (Overview tab, Tree-only,
  co-located with `IntentCard`), `BlastTab` + `_components/BlastGraph` (dedicated tab, Tree/Graph
  toggle — Graph is a hand-rolled fixed-column SVG, no new chart dependency), wired into
  `page.tsx`/`PrDetailHeader`/`OverviewTab`. Reused the existing `onOpenInDiff(file, line)`
  click-to-code mechanism unchanged (no new deep-link logic). Confirmed `next/link` (`<Link
  href="?tab=blast">`) renders and is clickable in RTL/jsdom with zero `next/navigation` mocking
  needed — only components calling `useRouter`/`useSearchParams` directly require that mock.
  41/41 client tests pass, `pnpm typecheck` clean.

- 2026-07-09: Closed both Blast Radius gaps recorded above (server `prior_prs` contract/query/
  service + `computeBlastStats` helper landed in earlier steps; this step wired the UI): stats
  line (`computeBlastStats(blast)` rendered under `SectionLabel`, before `symbolList`/view blocks
  in `BlastRadiusCard`/`BlastTab`) and a collapsible "Prior PRs touching these files" section
  (`Icon.Clock` + `Badge` count + `next/link` `#number title` rows, shown only when
  `prior_prs.length > 0`, collapsed by default) in both components. `BlastTab` gained a new
  required `repoId: string` prop (threaded from `page.tsx`). 64/64 client tests pass, `pnpm
  typecheck` clean. A pre-existing gap was caught and fixed post-integration: `src/lib/
  blast-stats.test.ts`'s local `blast()` test-data builder was missing the now-required
  `prior_prs` field (added by the server contract step) — this broke `pnpm typecheck` on that one
  file after Step 1 landed, undetected until Step 3 ran a fresh typecheck; fixed with one line
  (`prior_prs: []` in the builder).

- 2026-07-15: `lib/hooks/index.ts` barrel is NOT auto-populated — adding a new hook file
  (e.g. `hooks/context.ts`) requires a manual `export * from "./context";` line or its
  hooks are only reachable via the direct path import (`@/lib/hooks/context`), not
  `@/lib/hooks`. A step whose file-list is scoped to just the new hook file (not
  `index.ts`) will correctly skip this — flag it for whichever step first renders a
  component that wants the barrel import.
- 2026-07-15: For a mutation whose PUT/POST route is scoped to one entity (e.g.
  `PUT /agents/:id/context`) but whose success needs to invalidate a query keyed by a
  DIFFERENT entity not in the URL (e.g. `["context", repoId]`, since docs are discovered
  per-repo but attached per-agent with no repo_id column), make that second id a required
  field on the mutation's input object — passed through to `onSuccess` for the extra
  `invalidateQueries` call, never sent in the request body. Optional/nullable would let a
  caller silently forget it and leave stale metrics cached.

- **Project Context page footer can't show a real "last scanned" time on initial load.**
  `GET /repos/:id/context` returns `ContextDoc[]` (no scan timestamp) and `repo_context_index`
  (which persists `scanned_at`) has no GET route — only `POST /repos/:id/context/reindex`'s
  response carries a `scanned_at`. The Project Context page (`app/repos/[repoId]/context/`)
  therefore only knows "last scanned" for the current browser session, after the user has clicked
  Re-index; before that it renders the doc-derived file/chunk counts without a "last … ago" clause
  (`context.indexedUnknown` vs `context.indexed` i18n keys) rather than fabricate a timestamp. If
  a persisted-on-load "last scanned" becomes a real requirement, it needs a new server route (or
  the value folded into `GET /repos/:id/context`'s response) — out of scope for a client-only step.

- 2026-07-15: The plan's "active repo" mechanism for repo-scoped pickers inside
  workspace-scoped entities (agents/skills have no `repo_id`) already exists —
  `useActiveRepo()` in `client/src/lib/repo-context.tsx` (NOT under `lib/hooks/`),
  returning `{ repoId, activeRepo, repos, setRepoId, reposLoaded }` from a
  `RepoProvider` context (URL `:repoId` > localStorage > first repo). A step
  briefed to "flag it as a gap if no such mechanism exists" should grep
  `lib/repo-context` before concluding one is missing. Also: the Agent Context
  tab (`AgentEditor/_components/ContextTab`) deliberately deviates from
  `SkillsTab`'s two-panel (linked | available) DnD layout — the plan calls for
  "one row per discovered doc" (attach state as a checkbox, not panel
  membership), so it's a single `SortableContext` over ALL discovered docs
  (attached-first, then alpha), with `persist()` filtering the full order down
  to just the attached subset before calling `useSetAgentContextDocs`. Only
  `SkillsTab`'s DnD *primitives* (dnd-kit sensors, `GripHandle`, optimistic
  `pendingOrder` cleared once server order matches) carry over, not its layout.
  **2026-07-15 correction**: recomputing `serverOrder` as attached-first on
  *every* attach/detach toggle (not just on load) was a real usability bug in
  practice — checking a box mid-list caused that row to instantly jump to the
  top/attached-block boundary, and un-checking dropped it back into the
  alphabetical "rest", both disorienting when checking several boxes in a
  row. Fixed: `handleToggle` now freezes `pendingOrder` to the current row
  order before persisting, so attach/detach only flips the checkbox in place;
  attached-first regrouping still happens on next full page load (fresh
  `serverOrder`, `pendingOrder` reset to null on remount). See the "Recurring
  Errors & Fixes" entry below for why this needed a one-shot reconcile-skip
  ref, not just a naive `setPendingOrder(order)`.

- 2026-07-15: Added the Skill Context tab (SPEC-01 step 9, Screen 3) as a
  separate component tree from `AgentEditor/_components/ContextTab` (skills
  and agents are different entities — only the row/DnD/Preview pattern is
  mirrored, not shared code). Two things worth flagging for future
  cross-entity "same UI, different entity" tabs: (1) `SkillsPage/constants.ts`'s
  `DETAIL_TABS` uses **hardcoded English `label` strings**, unlike
  `AgentEditor/constants.ts`'s `TABS` which uses a `labelKey` resolved via
  `t()` — the two tab-bar patterns are inconsistent within the same codebase;
  match whichever pattern the file you're editing already uses rather than
  "fixing" it as part of an unrelated feature step. (2) `SkillDetailPanel.tsx`'s
  `detailTabBody` (`styles.ts`, padding 28 + overflow auto) needs a per-tab
  inline override to `{ padding: 0, overflow: "hidden" }` for a full-height
  row-list/DnD tab, exactly like `AgentEditor.tsx` already does for its own
  `skills`/`context` tabs — done inline in the `.tsx` file (conditional on
  `activeTab`), not by editing `styles.ts`, since a plan step's file list may
  legitimately omit `styles.ts` from what a component tab is allowed to touch.

- **2026-07-16: Overview tab redesigned to match the original PR-Brief mockup** —
  `VerdictBanner` (existing, previously only mounted inside `ReviewRunAccordion` on the
  Findings tab) is now ALSO mounted at the top of `PrBriefCard` via an optional
  `latestReview` prop (computed in `page.tsx` from `runs[0]`, the newest `usePrReviews`
  row — same "latest review" convention as the server's `pulls/routes.ts`). `IntentCard` +
  a new `RiskAreasCard` (renders `brief.risks` as collapsible rows, severity icon +
  clickable `file_refs` + chevron-revealed explanation) now sit in the LEFT column of a
  new `OverviewTab` CSS grid (`s.grid`/`s.gridCol`), with `BlastRadiusCard` in the right
  column; a new `ReviewFocusSection` renders `brief.review_focus` as its own full-width
  section below the grid (one line per item: bullet + `MonoLink` + reason), instead of
  being nested inside `PrBriefCard`. Three sibling components (`PrBriefCard`,
  `RiskAreasCard`, `ReviewFocusSection`) now each independently call `usePrBrief(prId)` —
  this is intentional, not a duplicated-fetch bug: TanStack Query dedups by `["pr-brief",
  prId]` queryKey, so it's one real network call no matter how many components read it,
  and keeps each component owning only the slice of `Brief` it renders (no prop drilling
  of the whole `Brief` object through `OverviewTab`). AC-14 ("no cost/token/model figure
  in the brief UI") still holds — `VerdictBanner` itself has no cost/token fields, so
  merging it in doesn't reintroduce what AC-14 forbids.
- **2026-07-16: fixed-height + internal scroll added to every Overview-tab card**
  (`PrBriefCard`/`IntentCard`/`RiskAreasCard`/`BlastRadiusCard`/`ReviewFocusSection`, all
  capped at `maxHeight: 420` + `overflowY: "auto"`) — this is the actual fix for the
  "BlastRadiusCard has no cap" entry below; the 213-symbol PR that made the grid 8000px
  tall now scrolls inside a 420px box instead (confirmed live: `document.querySelector('main').scrollHeight`
  went from 8459 → 1894 on the same PR). Two non-obvious traps hit while doing this:
  (1) **`IntentCard`'s model-picker (`SearchableSelect`) renders its dropdown via
  `position: absolute` relative to its own wrapper — NOT a portal** (`vendor/ui/kit/
  SearchableSelect.tsx`), so putting `overflow: auto` on an ancestor clips the open
  dropdown the instant it needs to extend past the scrolled edge. Fix: split `IntentCard`'s
  body into an inner `s.scrollArea` (intent text + in/out-scope, its own `overflowY:auto`
  + `minHeight:0`) and leave `modelRow` OUTSIDE it, still inside the outer (non-scrolling,
  just `maxHeight`-capped) `s.card` — a "scrollable middle, pinned footer" split. Any future
  card that scrolls AND has a dropdown/popover inside must use this same split, not a single
  `overflow:auto` wrapper. (2) **A long unbroken path (a `MonoLink`, e.g. a file path with no
  spaces) inside a `flex-wrap: wrap` row doesn't wrap internally — it overflows the row**,
  because a flex item's default `min-width: auto` floors it at its own content width
  (browsers don't apply `overflow-wrap` line-breaking to a flex item until it's allowed to
  shrink below that). Fixed at the ROOT — `vendor/ui/primitives/MonoLink.tsx` itself now sets
  `overflowWrap: "anywhere"`, `wordBreak: "break-word"`, `whiteSpace: "normal"`, `maxWidth:
  "100%"`, `textAlign: "left"` (the last because `<button>`'s UA default centers text, wrong
  once it wraps to 2+ lines) — fixes every consumer at once, not just the Overview cards.
  Still needed per-call-site: `minWidth: 0` on the immediate flex parent holding the
  `MonoLink` (`RiskAreasCard`'s `fileRefs`, `BlastRadiusCard`'s `callerLine`,
  `ReviewFocusSection`'s `item`) — the `MonoLink`-level fix alone isn't enough if its flex
  ancestor still refuses to shrink.
- **2026-07-16: `BlastRadiusCard`'s symbol list has no cap, and rows out the whole grid on a
  large PR** — confirmed live (PR with 213 changed symbols / 89 callers): the card renders
  every symbol as its own collapsible row with no "show more"/virtualization, so the right
  grid column (`BlastRadiusCard`) ends up ~8000px tall while the left column
  (`IntentCard`+`RiskAreasCard`) is ~1000px — the two-column Overview grid (see entry
  above) loses all visual parity on any PR whose blast radius is large, even though it
  looks correct on a small demo PR (this was NOT introduced by the 2026-07-16 grid change;
  `BlastRadiusCard`'s own list rendering predates it and was already this way before —
  just newly SIDE BY SIDE with a much shorter Intent column, which is what makes the
  imbalance visible instead of just "one more long full-width card"). Not fixed — would
  need `BlastRadiusCard` to cap/paginate/virtualize its own symbol list, out of scope for
  a layout-parity fix.

## Open Questions

- **RESOLVED 2026-07-09** — both gaps closed, see the matching Session Notes entry below
  (`server/specs/blast-radius-gaps.md`). Left below for historical context, not still open.
- **Blast Radius UI has 2 confirmed gaps vs. the original design mockup** (found 2026-07-09 by
  comparing live screenshots against the target mockup, verified against actual code — not
  guessed): (1) no aggregate stats line in the card/tab header (mockup shows "N symbols · N
  callers · N endpoints · N cron"; neither `BlastRadiusCard.tsx` nor `BlastTab.tsx` renders one,
  and no i18n key for it exists in `messages/en/prReview.json`'s `blast` block); (2) a "Prior PRs
  touching these files" collapsible section shown in the mockup is entirely unbuilt — no field on
  the `BlastRadius` shared contract (`server/src/vendor/shared/contracts/brief.ts`, only
  `changed_symbols`/`downstream`/`summary`), no server logic, no UI, no i18n key. Separately, the
  compact `BlastRadiusCard` being Tree-only (no Graph toggle inline, unlike the mockup) is a
  **deliberate** decision already recorded in this file's 2026-07-09 Session Notes entry, not a
  gap. ⇒ Before extending Blast Radius, don't assume "no endpoint/cron badges visible in a
  screenshot" means that feature is missing — `endpoints_affected`/`crons_affected` badges ARE
  implemented in both `BlastRadiusCard` and `BlastTab`; they just render conditionally and were
  simply empty (0 impact) on the specific PR captured in that screenshot.

- 2026-07-16: `lib/types.ts`'s re-export allowlist is per-name, not per-contract-file — `Brief`
  is re-exported but `Risk`/`RiskSeverity` (building blocks `Brief.risks[]`/`Brief.risk_level`
  reuse from the same vendored `contracts/brief.ts`) are NOT, because nothing else in the client
  needed them standalone before. A step scoped to files that exclude `lib/types.ts` can't add the
  missing export — derive the nested type structurally instead (`type RiskLevel =
  Brief["risk_level"]`, `type RiskItem = Brief["risks"][number]`) rather than importing from the
  vendored `@devdigest/shared` path directly (breaks the "always import from `lib/types.ts`"
  convention) or widening the step's file list. Also: `@devdigest/ui`'s `SeverityBadge` takes a
  `Severity` (`CRITICAL|WARNING|SUGGESTION|INFO`, the *findings* severity enum) — it does NOT
  accept `RiskSeverity` (`high|medium|low`, the *Brief risk* enum used by `PrBriefCard`); despite
  the similar name/purpose these are two distinct enums and `SeverityBadge` cannot be reused
  as-is for a risk-level chip. Built a small local chip instead, reusing the same `--crit`/
  `--warn`/`--ok` theme CSS vars `SeverityBadge` draws from (colour + a distinct icon per level:
  `AlertOctagon`/`AlertTriangle`/`CheckCircle`) so it stays on-theme and satisfies the
  colour-plus-non-colour-cue a11y requirement without a new hardcoded palette.

- 2026-07-29 (SPEC-03 eval pipeline, step 6): `Agent` is likewise NOT in `lib/types.ts`'s
  re-export allowlist (only the new `Eval*`/`AgentVersion` names were added there for this
  feature) — a hook file (`hooks/evals.ts`) that needs `Agent` for a mutation's return type
  must import it from `@devdigest/shared` directly, mirroring the existing convention already
  used by `hooks/agents.ts`, not from `../types`. Confirms the 2026-07-16 entry above generalizes
  beyond `Brief`/`Risk`.
- 2026-07-29: jsdom's `HTMLDivElement.isContentEditable` reads back as `undefined`, not `false`
  (unlike a real browser). `app-shell/helpers.ts`'s `isTextInput` does
  `!!node && (tagName === 'INPUT' || tagName === 'TEXTAREA' || node.isContentEditable)` — for a
  plain, non-editable `<div>` this makes the whole `||` chain evaluate to `undefined` (the last
  falsy operand), not `false`, under jsdom/vitest. The function's real callers only use it in a
  boolean context (`if (isTextInput(...))`) so this is harmless in production, but a unit test
  asserting `.toBe(false)` on a non-input element will fail in this test environment — assert
  `.toBeFalsy()` instead when testing this helper (or any helper with the same `||`-chain-ending-
  in-a-DOM-boolean-property shape).
- 2026-07-29: TanStack Query v5's `refetchInterval` option accepts a function of the query object
  (`(query) => query.state.data?.someField === 'running' ? intervalMs : false`), not just a static
  number/`false` — use this to poll only while a resource is in an active/running state (e.g. an
  eval batch's `status`) and stop automatically once it settles, rather than a `useEffect` +
  manual `setInterval`/`clearInterval` or an always-on fixed interval.
- 2026-07-29 (SPEC-03 eval pipeline, step 9 — `/eval` + `/eval/[agentId]` + CompareModal): the
  vendored `Checkbox` (`vendor/ui/kit/Checkbox.tsx`) has NO `disabled` prop — it's a fixed
  `checked`/`onChange`/`label` signature. For a max-N-selection constraint (AC-27's "prevent
  selecting a third"), don't rely on wrapping it in a `pointerEvents: "none"` style to block the
  click: jsdom/RTL's `fireEvent.click` does not implement CSS `pointer-events` at all, so a test
  clicking a capped-out checkbox would still fire `onClick` regardless of that wrapper style. The
  only real prevention has to be in the state-update logic itself — a pure `toggleSelection(prev,
  id, checked)` helper that no-ops (returns the same array reference) once `prev.length >= max`
  when `checked` is true, always allows unchecking. Keep the `pointerEvents`/`opacity` wrapper only
  as a visual affordance, not the actual guard, and unit-test the pure helper directly rather than
  asserting on inert CSS.
- 2026-07-29: a component that calls `useToast()` (`lib/toast.tsx`) throws
  `"useToast must be used within <ToastProvider>"` if a test renders it without wrapping in the
  real `<ToastProvider>` — mocking `@/lib/toast` isn't necessary/worth it, `ToastProvider` itself
  has no network/timers-that-matter for a synchronous render, so just wrap the test's render tree
  in the real provider (`<ToastProvider>{ui}</ToastProvider>`), same as
  `AgentEditor.test.tsx` already does.
- 2026-07-29: when `Edit`'s `old_string` for a JSON message file spans two sibling blocks (e.g. the
  tail of one top-level key plus the following key's opening brace, to disambiguate a duplicate
  line), double-check which block the *new* key actually lands inside afterward — an insertion
  placed right before a `},\n  "nextBlock": {` boundary line is easy to accidentally leave inside
  the FIRST block instead of the second. Caught here because a component's `t("compare.
  compareAction")` call resolved to the untranslated key string at runtime (next-intl's fallback)
  even though the JSON parsed fine and had a same-named key — it had landed one nesting level up,
  inside `"workspace"` instead of `"compare"`. `next-intl`'s missing-key behavior is a silent
  fallback to the raw key path, not a build/typecheck error, so this only surfaces at
  render/test time, never at `pnpm typecheck`.
