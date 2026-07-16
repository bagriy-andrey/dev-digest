import type { CSSProperties } from "react";

/** Co-located styles for ReviewFocusSection (one-line-per-item focus list). */
export const s = {
  card: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-elevated)",
    padding: 18,
    maxHeight: 420,
    overflowY: "auto",
    overflowX: "hidden",
  } satisfies CSSProperties,
  list: {
    margin: 0,
    padding: 0,
    listStyle: "none",
    display: "flex",
    flexDirection: "column",
    gap: 10,
  } satisfies CSSProperties,
  item: {
    display: "flex",
    alignItems: "baseline",
    gap: 8,
    fontSize: 13.5,
    flexWrap: "wrap",
    minWidth: 0,
  } satisfies CSSProperties,
  bulletIcon: {
    color: "var(--text-muted)",
    flexShrink: 0,
    alignSelf: "center",
  } satisfies CSSProperties,
  dash: {
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  reason: {
    color: "var(--text-secondary)",
    lineHeight: 1.5,
  } satisfies CSSProperties,
} as const;
