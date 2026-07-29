import type { CSSProperties } from "react";

export const s = {
  root: { display: "flex", flexDirection: "column", gap: 20 } satisfies CSSProperties,

  header: {
    display: "flex",
    alignItems: "center",
    gap: 10,
  } satisfies CSSProperties,
  headerTitle: { fontSize: 14, fontWeight: 700, flex: 1 } satisfies CSSProperties,

  list: { display: "flex", flexDirection: "column", gap: 8 } satisfies CSSProperties,

  row: {
    display: "flex",
    alignItems: "flex-start",
    gap: 12,
    padding: "12px 14px",
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--bg-surface)",
  } satisfies CSSProperties,
  rowMain: { flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 6 } satisfies CSSProperties,
  rowTop: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" } satisfies CSSProperties,
  rowName: { fontSize: 14, fontWeight: 600 } satisfies CSSProperties,
  rowTags: { display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" } satisfies CSSProperties,
  rowStatus: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: 12.5,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  rowFailureReason: { fontSize: 12, color: "var(--crit)" } satisfies CSSProperties,
  rowActions: { display: "flex", alignItems: "center", gap: 4, flexShrink: 0 } satisfies CSSProperties,

  loading: { fontSize: 13, color: "var(--text-muted)", padding: "12px 0" } satisfies CSSProperties,

  // Case editor modal
  modalBody: { padding: "20px 24px", display: "flex", flexDirection: "column", gap: 4 } satisfies CSSProperties,
  inputTabsBar: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    overflow: "hidden",
    marginBottom: 20,
  } satisfies CSSProperties,
  inputTabBody: {
    padding: 14,
    background: "var(--bg-elevated)",
    fontSize: 13,
    color: "var(--text-secondary)",
    maxHeight: 220,
    overflow: "auto",
  } satisfies CSSProperties,
  diffBlock: {
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    fontFamily: "var(--font-mono, monospace)",
    fontSize: 12.5,
    margin: 0,
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  metaRow: { display: "flex", flexDirection: "column", gap: 4, marginBottom: 12 } satisfies CSSProperties,
  metaLabel: { fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase" } satisfies CSSProperties,
  metaValue: { fontSize: 13, color: "var(--text-primary)" } satisfies CSSProperties,
  fileRow: { display: "flex", alignItems: "center", gap: 8, fontFamily: "var(--font-mono, monospace)", fontSize: 12.5 } satisfies CSSProperties,

  expectedOutputHeader: { display: "flex", alignItems: "center", gap: 8 } satisfies CSSProperties,
  validityBadge: { display: "flex", alignItems: "center", gap: 4, fontSize: 12, fontWeight: 600 } satisfies CSSProperties,
  validationError: { fontSize: 12, color: "var(--crit)", marginTop: 6 } satisfies CSSProperties,

  lastRunStrip: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    padding: "12px 14px",
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
    marginTop: 4,
    marginBottom: 20,
  } satisfies CSSProperties,
  lastRunHeadline: { display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 600 } satisfies CSSProperties,
  lastRunDetail: { fontSize: 12, color: "var(--text-secondary)" } satisfies CSSProperties,

  runOnSaveRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    marginTop: 4,
    marginBottom: 4,
  } satisfies CSSProperties,

  footer: { display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8 } satisfies CSSProperties,
} as const;
