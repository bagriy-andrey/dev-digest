# client — insights

> Durable, non-obvious learnings for `@devdigest/web` (Next.js studio UI, TanStack Query,
> vendored UI/contracts). Maintained via the `engineering-insights` skill: append-only,
> deduplicated, substance only. Read before working; empty sections are expected, not a bug.
> Cross-package facts go in the repo-root `insights.md`.

## What Works

- `position: fixed` tooltips escape `overflow: hidden` ancestors without a React portal — the PR list table card uses `overflow: hidden` for border-radius clipping, but `position: fixed` is positioned relative to the viewport and is never clipped by parent overflow. Use `getBoundingClientRect()` on the trigger element to place the tooltip; set `pointerEvents: "none"` so it doesn't interfere with mouse-leave events.

## What Doesn't Work

## Codebase Patterns

## Tool & Library Notes

- `SeverityBadge` (from `@devdigest/ui`) accepts a `count` prop that renders an inline number alongside the icon — no wrapper or custom chip needed when you want "CRITICAL 3"-style counters.

## Recurring Errors & Fixes

## Session Notes

- 2026-06-22: implemented per-severity aggregated counter strip on the PR findings tab with click-to-filter; state in `FindingsTab`, threaded through `ReviewRunAccordion` → `FindingsPanel` → `visibleFindings` (4 files, no new APIs or components).
- 2026-06-22: added FINDINGS column to PR list table — `COLUMN_KEYS` + `GRID` in `constants.ts` are the two places to update; `PRRow` renders compact `SeverityBadge` chips from `pr.findings_by_severity` (server-computed, new field on `PrMeta`).
- 2026-06-22: added hover tooltip to FINDINGS column — `position: fixed` card in `PRRow`, data via new `PrMeta.findings: PrFindingSummary[]` (capped at 10, sorted by severity server-side). `Icon.Circle` does not exist in the registry; use `Icon.Dot` instead.

## Open Questions
