import type { CSSProperties } from "react";

/** Co-located styles for PrBriefCard (PR Why + Risk Brief summary). */
export const s = {
  verdictWrap: {
    marginBottom: 14,
  } satisfies CSSProperties,
  card: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-elevated)",
    padding: 18,
    display: "flex",
    flexDirection: "column",
    gap: 14,
    maxHeight: 420,
    overflowY: "auto",
    overflowX: "hidden",
  } satisfies CSSProperties,
  empty: {
    fontSize: 14,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  error: {
    fontSize: 13,
    color: "var(--danger)",
  } satisfies CSSProperties,
  section: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
  } satisfies CSSProperties,
  sectionLabel: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  bodyText: {
    margin: 0,
    fontSize: 14,
    color: "var(--text-secondary)",
    lineHeight: 1.55,
  } satisfies CSSProperties,
  riskLevelRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
  } satisfies CSSProperties,
  riskLevelChip: (color: string, bg: string): CSSProperties => ({
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "3px 9px",
    borderRadius: 5,
    fontSize: 12,
    fontWeight: 600,
    color,
    background: bg,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
  }),
} as const;
