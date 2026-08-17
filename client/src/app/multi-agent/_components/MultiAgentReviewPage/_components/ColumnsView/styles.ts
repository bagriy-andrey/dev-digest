import type { CSSProperties } from "react";

export const s = {
  strip: {
    display: "flex",
    gap: 14,
    overflowX: "auto",
    paddingBottom: 4,
  } satisfies CSSProperties,
  column: {
    flex: "0 0 300px",
    minWidth: 300,
    display: "flex",
    flexDirection: "column",
    gap: 12,
  } satisfies CSSProperties,
  columnHead: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
  } satisfies CSSProperties,
  agentName: {
    fontSize: 14,
    fontWeight: 700,
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  statusRow: (color: string): CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: 12.5,
    fontWeight: 600,
    color,
  }),
  metaRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    fontSize: 12,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  summary: {
    fontSize: 12.5,
    color: "var(--text-secondary)",
    whiteSpace: "pre-wrap",
  } satisfies CSSProperties,
  findingsStack: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
  } satisfies CSSProperties,
  finding: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    padding: "8px 10px",
    borderRadius: 6,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  findingTitle: {
    fontSize: 13,
    fontWeight: 600,
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  findingLocation: {
    fontSize: 11.5,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  emptyFindings: {
    fontSize: 12.5,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
} as const;
