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

- **RTL `getByText("exact string")` fails on a line built from multiple sibling `{t(...)}` calls
  joined by literal `·` separators with no wrapping `<span>` per segment** — e.g. `{t("a")} ·{" "}
  {t("b")}` inside one `<div>`. Each `{t(...)}` call is its own text node, but since they're all
  direct children of the same element (no nested elements), that element's own normalized
  `textContent` IS the full concatenated line — so `getByText` still matches, but only against the
  **entire** joined string (`"2 symbols · 2 callers · 1 endpoint · 1 cron"`), never a substring
  segment alone (`getByText("2 symbols")` throws "text is broken up by multiple elements"). Assert
  on the whole rendered line, not per-segment substrings, unless you wrap each stat in its own
  element.

## Recurring Errors & Fixes

- **CSS var hardcoded fallback breaks dark mode**: `var(--token, #hardcoded-light-color)` silently renders the hex fallback in dark mode when `--token` is undefined. Always use another CSS variable as fallback (`var(--token, var(--other-token))`) or omit the fallback and define the token in the theme. Fixed: `var(--accent-subtle, #f0f7ff)` → `var(--accent-bg)` on the selected CandidateCard background.
- **List thrashing after TanStack Query refetch**: toggling any field (e.g. `enabled`) triggers a query invalidation + refetch; the server response can return rows in a different order, causing visible list jumps. Fix: always `[...list].sort((a, b) => a.name.localeCompare(b.name))` client-side before rendering — in `useMemo` for derived arrays, or inline in the `.map()` call. Apply this to every list whose order must be stable across refetches.
- **`MonoLink` (`@devdigest/ui`) button-mode doesn't stop propagation**: its `href` (anchor) branch calls `e.stopPropagation()` on click, but its `onClick` (button) branch does not. Nesting a `MonoLink` inside another clickable row/header (e.g. `FindingCard`'s expand-toggle header) means clicking it also bubbles up and fires the parent's handler. Fix: wrap it in `<span onClick={(e) => e.stopPropagation()}>` at the callsite — `MonoLink`'s own `onClick` prop signature is `() => void` (no event), so you can't stop propagation from inside the callback itself.

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
