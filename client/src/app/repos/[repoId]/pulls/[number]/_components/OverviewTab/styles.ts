import type { CSSProperties } from "react";

export const s = {
  /** Intent(+Risk Areas) | Blast Radius — collapses to one column on narrow
   *  viewports since each card's own content isn't designed for < ~360px. */
  grid: {
    display: "grid",
    gridTemplateColumns: "minmax(320px, 1fr) minmax(320px, 1fr)",
    gap: 24,
  } satisfies CSSProperties,
  gridCol: {
    display: "flex",
    flexDirection: "column",
    gap: 24,
    minWidth: 0,
  } satisfies CSSProperties,
  descriptionBox: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-elevated)",
    padding: 18,
    fontSize: 14,
    color: "var(--text-secondary)",
    whiteSpace: "pre-wrap",
    lineHeight: 1.55,
  } satisfies CSSProperties,
} as const;
