import type { CSSProperties } from "react";

export const s = {
  root: { display: "flex", flexDirection: "column", gap: 20 } satisfies CSSProperties,

  header: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" } satisfies CSSProperties,
  headerText: { flex: 1, minWidth: 200 } satisfies CSSProperties,
  heading: { fontSize: 14, fontWeight: 700, margin: 0 } satisfies CSSProperties,
  subtitle: { fontSize: 12.5, color: "var(--text-secondary)", margin: "2px 0 0" } satisfies CSSProperties,
  actions: { display: "flex", alignItems: "center", gap: 8 } satisfies CSSProperties,

  list: { display: "flex", flexDirection: "column", gap: 8 } satisfies CSSProperties,
  row: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "12px 14px",
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--bg-surface)",
    flexWrap: "wrap",
  } satisfies CSSProperties,
  rowMain: { display: "flex", alignItems: "center", gap: 10, flex: 1, minWidth: 200 } satisfies CSSProperties,
  rowRepo: { fontSize: 13.5, fontWeight: 600 } satisfies CSSProperties,
  rowInstalled: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  rowStatus: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: 12.5,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  rowTime: { color: "var(--text-muted)" } satisfies CSSProperties,

  failCiOnSection: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    paddingTop: 8,
    borderTop: "1px solid var(--border)",
  } satisfies CSSProperties,
  staleNotice: { fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5, margin: 0 } satisfies CSSProperties,
} as const;
