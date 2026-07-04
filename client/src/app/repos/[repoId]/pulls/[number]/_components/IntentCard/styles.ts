import type { CSSProperties } from "react";

/** Co-located styles for IntentCard (PR intent/scope summary + recalculate + model picker). */
export const s = {
  card: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-elevated)",
    padding: 18,
    display: "flex",
    flexDirection: "column",
    gap: 14,
  } satisfies CSSProperties,
  empty: {
    fontSize: 14,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  summary: {
    margin: 0,
    fontSize: 14,
    color: "var(--text-secondary)",
    lineHeight: 1.55,
  } satisfies CSSProperties,
  list: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
  } satisfies CSSProperties,
  listLabel: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  ul: {
    margin: 0,
    paddingLeft: 18,
    fontSize: 13,
    color: "var(--text-secondary)",
    lineHeight: 1.6,
  } satisfies CSSProperties,
  error: {
    fontSize: 13,
    color: "var(--danger)",
  } satisfies CSSProperties,
  modelRow: {
    borderTop: "1px solid var(--border)",
    paddingTop: 14,
    maxWidth: 420,
  } satisfies CSSProperties,
  defaultTag: {
    marginLeft: 8,
    fontSize: 12,
    fontWeight: 500,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
} as const;
