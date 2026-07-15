import type { CSSProperties } from "react";

export const s = {
  root: { display: "flex", flexDirection: "column", height: "100%", minHeight: 0 } satisfies CSSProperties,

  header: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "16px 24px 12px",
    borderBottom: "1px solid var(--border)",
    flexShrink: 0,
  } satisfies CSSProperties,
  headerTitle: { fontSize: 13, fontWeight: 600, color: "var(--text-secondary)" } satisfies CSSProperties,

  list: { flex: 1, overflowY: "auto", minHeight: 0, padding: "8px 16px 12px" } satisfies CSSProperties,

  row: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "9px 10px 9px 4px",
    borderBottom: "1px solid var(--border)",
    background: "var(--bg-surface)",
  } satisfies CSSProperties,
  rowFilename: {
    flex: 1,
    fontFamily: "var(--font-mono, monospace)",
    fontSize: 13,
    fontWeight: 600,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,

  empty: {
    padding: "20px 12px",
    fontSize: 13,
    color: "var(--text-muted)",
    textAlign: "center",
    lineHeight: 1.5,
  } satisfies CSSProperties,

  footer: {
    flexShrink: 0,
    display: "flex",
    flexDirection: "column",
    gap: 4,
    padding: "12px 24px",
    borderTop: "1px solid var(--border)",
    background: "var(--bg-surface)",
  } satisfies CSSProperties,
  footerLine: {
    fontSize: 12.5,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  footerNote: {
    fontSize: 12,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
} as const;
