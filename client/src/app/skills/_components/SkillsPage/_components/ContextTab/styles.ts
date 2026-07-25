import type { CSSProperties } from "react";

export const s = {
  root: { display: "flex", flexDirection: "column", height: "100%", minHeight: 0 } satisfies CSSProperties,

  header: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    padding: "16px 24px 12px",
    borderBottom: "1px solid var(--border)",
    flexShrink: 0,
  } satisfies CSSProperties,
  headerTop: { display: "flex", alignItems: "center", gap: 10 } satisfies CSSProperties,
  headerTitle: { fontSize: 13, fontWeight: 600, color: "var(--text-secondary)" } satisfies CSSProperties,
  headerHelper: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,

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

  // read-only "SERIALIZES AS" box (AC-13) — lists the paths this skill
  // contributes to the effective attached-doc set, in serialization order.
  serializesBox: {
    flexShrink: 0,
    padding: "12px 24px 16px",
    borderTop: "1px solid var(--border)",
    background: "var(--bg-surface)",
  } satisfies CSSProperties,
  serializesLabel: {
    fontSize: 11,
    fontWeight: 700,
    color: "var(--text-muted)",
    letterSpacing: "0.06em",
    marginBottom: 8,
  } satisfies CSSProperties,
  serializesList: {
    listStyle: "none",
    margin: 0,
    padding: 0,
    display: "flex",
    flexDirection: "column",
    gap: 4,
  } satisfies CSSProperties,
  serializesItem: {
    fontFamily: "var(--font-mono, monospace)",
    fontSize: 12.5,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  serializesEmpty: {
    fontSize: 12.5,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
} as const;
