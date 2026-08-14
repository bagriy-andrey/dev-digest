import type { CSSProperties } from "react";

/** Co-located styles for the Compare modal. */
export const s = {
  body: {
    display: "flex",
    flexDirection: "column",
    gap: 20,
    padding: 24,
  } satisfies CSSProperties,
  sideHeads: {
    display: "flex",
    gap: 20,
    fontSize: 13,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  deltaGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(4, 1fr)",
    gap: 12,
  } satisfies CSSProperties,
  statCard: {
    background: "var(--bg-surface)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    padding: 12,
    display: "flex",
    flexDirection: "column",
    gap: 6,
  } satisfies CSSProperties,
  statLabel: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.05em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  statValues: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: 14,
    fontWeight: 600,
  } satisfies CSSProperties,
  chip: (color: string): CSSProperties => ({
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    fontSize: 12,
    fontWeight: 600,
    color,
  }),
  caseSetNote: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    fontSize: 12.5,
    color: "var(--warn)",
  } satisfies CSSProperties,
  promptGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 20,
  } satisfies CSSProperties,
  promptBox: {
    margin: 0,
    padding: 12,
    background: "var(--bg-surface)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    fontSize: 12.5,
    fontFamily: "var(--font-mono, monospace)",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    maxHeight: 220,
    overflow: "auto",
  } satisfies CSSProperties,
  versionNote: {
    fontSize: 13,
    color: "var(--text-muted)",
    fontStyle: "italic",
    margin: 0,
  } satisfies CSSProperties,
  promoteBar: {
    display: "flex",
    alignItems: "center",
    gap: 10,
  } satisfies CSSProperties,
  disabledReason: {
    fontSize: 12.5,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
} as const;
