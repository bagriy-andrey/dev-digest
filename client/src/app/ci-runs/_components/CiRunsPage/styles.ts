import type { CSSProperties } from "react";

export const s = {
  pageHeader: {
    padding: "24px 32px 10px",
    display: "flex",
    alignItems: "flex-end",
    gap: 16,
  } satisfies CSSProperties,
  pageTitle: { fontSize: 24, fontWeight: 700, letterSpacing: "-0.02em" } satisfies CSSProperties,
  pageSubtitle: { fontSize: 13, color: "var(--text-secondary)", margin: "2px 0 0" } satisfies CSSProperties,
  headerText: { flex: 1, minWidth: 0 } satisfies CSSProperties,

  tableCard: {
    margin: "0 32px 20px",
    border: "1px solid var(--border)",
    borderRadius: 10,
    overflow: "hidden",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  headRow: (grid: string): CSSProperties => ({
    display: "grid",
    gridTemplateColumns: grid,
    gap: 14,
    padding: "10px 20px",
    borderBottom: "1px solid var(--border)",
    background: "var(--bg-surface)",
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: "0.06em",
    color: "var(--text-muted)",
    textTransform: "uppercase",
  }),
  runRow: (grid: string): CSSProperties => ({
    display: "grid",
    gridTemplateColumns: grid,
    alignItems: "center",
    gap: 14,
    padding: "10px 20px",
    borderBottom: "1px solid var(--border)",
    fontSize: 13,
  }),
  ellipsis: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    minWidth: 0,
  } satisfies CSSProperties,
  statusCell: { display: "inline-flex", alignItems: "center", gap: 6 } satisfies CSSProperties,
  viewJobLink: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    color: "var(--accent)",
    textDecoration: "none",
    fontSize: 12.5,
  } satisfies CSSProperties,

  loadingStack: { padding: "0 32px 20px", display: "flex", flexDirection: "column", gap: 10 } satisfies CSSProperties,
} as const;
