import type { CSSProperties } from "react";

export const s = {
  root: { display: "flex", flexDirection: "column", height: "calc(100vh - 52px)" } satisfies CSSProperties,
  body: { display: "flex", flex: 1, minHeight: 0 } satisfies CSSProperties,

  // left panel — doc list grouped by source_type
  left: {
    width: 300,
    flexShrink: 0,
    borderRight: "1px solid var(--border)",
    display: "flex",
    flexDirection: "column",
    background: "var(--bg-surface)",
    overflow: "hidden",
  } satisfies CSSProperties,
  leftHeader: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "16px 16px 12px",
    borderBottom: "1px solid var(--border)",
    flexShrink: 0,
  } satisfies CSSProperties,
  leftTitle: { fontSize: 18, fontWeight: 700, flex: 1 } satisfies CSSProperties,
  list: { flex: 1, overflow: "auto", padding: "8px 8px 12px" } satisfies CSSProperties,
  groupLabel: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.06em",
    color: "var(--text-muted)",
    padding: "10px 8px 6px",
  } satisfies CSSProperties,

  // right panel — selected doc header + preview
  right: { flex: 1, display: "flex", flexDirection: "column", minWidth: 0, overflow: "hidden" } satisfies CSSProperties,

  // footer status bar
  footer: {
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "10px 20px",
    borderTop: "1px solid var(--border)",
    background: "var(--bg-surface)",
    fontSize: 12.5,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,

  // doc list row
  row: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "8px 10px",
    borderRadius: 8,
    cursor: "pointer",
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: "transparent",
    marginBottom: 2,
  } satisfies CSSProperties,
  rowActive: { background: "var(--bg-elevated)", borderColor: "var(--accent)" } satisfies CSSProperties,
  rowFilename: {
    flex: 1,
    fontFamily: "var(--font-mono, monospace)",
    fontSize: 12.5,
    fontWeight: 600,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,

  // doc preview panel
  previewHeader: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "16px 24px",
    borderBottom: "1px solid var(--border)",
    flexShrink: 0,
  } satisfies CSSProperties,
  previewTitle: {
    fontFamily: "var(--font-mono, monospace)",
    fontSize: 15,
    fontWeight: 700,
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  previewBody: { flex: 1, overflow: "auto", padding: "24px 28px" } satisfies CSSProperties,
  previewCard: {
    background: "var(--bg-elevated)",
    color: "var(--text-primary)",
    borderRadius: 10,
    padding: "28px 32px",
    maxWidth: 760,
    overflowX: "auto",
    fontSize: 14,
    lineHeight: 1.65,
  } satisfies CSSProperties,

  selectPrompt: {
    flex: 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "var(--text-muted)",
    textAlign: "center",
  } satisfies CSSProperties,
} as const;
