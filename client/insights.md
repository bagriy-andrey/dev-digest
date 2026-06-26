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

## What Doesn't Work

- Deep relative imports (`../../../../../../../lib/hooks`) inside nested `_components` bypass the `@/` alias that is already configured. The alias works and is used in some files; the rest should be migrated. Seven-level paths are a DX hazard and break easily on file moves.
- `window.confirm` with hardcoded English strings (found in `PRDetailPage`'s delete-run handler) bypasses the next-intl i18n system. Any user-facing string must go through `t("...")`.
- `setTimeout` without `clearTimeout` cleanup (found in `RunTraceDrawer.copyRaw`) can trigger state updates on unmounted components. Always pair `setTimeout` with a `useRef` + cleanup.

## Codebase Patterns

- `@/` path alias (`src/*`) is configured in tsconfig but inconsistently used: top-level `app/` files use it, deeply nested `_components` often fall back to relative paths. Convention: always use `@/` for anything outside the immediate component folder.
- Domain input types (`ActiveRun`, `CreateCommentInput`, `RunReviewInput`) are currently defined inside `lib/hooks/reviews.ts` rather than in `lib/types.ts`. This forces consumers to import types from the hook file. New domain types should land in `lib/types.ts`.
- All components use named exports (`export function X`) except `RunTraceDrawer` which uses `export default`. Inconsistency breaks barrel-file tooling. Prefer named exports throughout.
- `PRDetailPage` (`repos/[repoId]/pulls/[number]/page.tsx`) is a god page: 186 lines, 12+ hooks, inline invalidation helpers not extracted to a custom hook. It is the outlier — every other page is lean. Pattern to follow: extract per-page orchestration into a `usePrDetailPage()` hook.
- Page-level `styles.ts` is missing for `PRDetailPage` (and some `RunTraceDrawer/_components`), leaving inline `style={{...}}` objects in JSX that create new object references each render. All other pages have co-located `styles.ts`.
- Filter/sort logic in `PullsPage` (`pulls/page.tsx`) is inline in the component body; the sibling `helpers.ts` exists but only holds `sizeOf` and `relativeTime`. Pattern: filter/sort utilities belong in `helpers.ts`, not in the render function.
- `OPEN_STATUSES` set is defined at the top of `PullsPage` component instead of in `constants.ts`. Any module-level constant referenced only within one feature should live in that feature's `constants.ts`.

## Tool & Library Notes

- `@monaco-editor/react` (v4.7.0) is now installed in client/. Use dynamic import with `next/dynamic` and `ssr: false` — Monaco does not run server-side. Wrap in a loading placeholder to avoid layout shift.
- File upload to Fastify must use raw `fetch` + `FormData` (not `api.post`) because `api.post` sets `content-type: application/json`, which breaks multipart. The `useImportSkillFile` hook does this correctly; do not refactor it through `api`.
- `@dnd-kit/core` + `@dnd-kit/sortable` (v6/v10) are installed. Cross-list DnD pattern used in `SkillsTab`: left panel items use `useSortable` inside `SortableContext`; right panel items use `useDraggable`; left container uses `useDroppable`. Distinguish source in `onDragEnd` via `active.data.current.type`. Use `arrayMove` from `@dnd-kit/sortable` for reorder. Apply optimistic local state (`pendingOrder`) to avoid list snap-back during in-flight mutations — clear it once the server-derived sort matches. A `Set` built from a `useMemo`-derived array must be rebuilt *inside* a child `useMemo` (not passed as a dep) — a `new Set(...)` reference always changes, causing the child memo to re-run every render. Tab bodies that need full-height two-column layout must opt out of the editor's default `padding: 28 / overflow: auto` by overriding `s.body` styles conditionally in `AgentEditor`.

## Recurring Errors & Fixes

- **List thrashing after TanStack Query refetch**: toggling any field (e.g. `enabled`) triggers a query invalidation + refetch; the server response can return rows in a different order, causing visible list jumps. Fix: always `[...list].sort((a, b) => a.name.localeCompare(b.name))` client-side before rendering — in `useMemo` for derived arrays, or inline in the `.map()` call. Apply this to every list whose order must be stable across refetches.

## Session Notes

- 2026-06-24: Full client/ architecture audit — identified 11 issues across import style, god-page pattern, type organization, i18n bypass, style consistency, and cleanup hygiene. No code changed; findings captured above.
- 2026-06-24: Migrated 8 files from deep relative imports (7 levels) to @/ alias: FindingCard.tsx, FindingsPanel.tsx + test, RunReviewDropdown.tsx + test, SettingsApiKeys.tsx + constants.ts, SettingsModels.tsx. Task 1 of 11 completed; tasks 2-11 remain pending.

## Open Questions
