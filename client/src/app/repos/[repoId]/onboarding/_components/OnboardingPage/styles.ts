import type { CSSProperties } from "react";

export const s = {
  root: {
    display: "flex",
    flexDirection: "column",
    height: "calc(100vh - 52px)",
    minHeight: 0,
  } satisfies CSSProperties,

  header: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "16px 28px",
    borderBottom: "1px solid var(--border)",
    flexShrink: 0,
    background: "var(--bg-surface)",
  } satisfies CSSProperties,
  headerTitle: { fontSize: 15, fontWeight: 600, color: "var(--text-secondary)", flex: 1 } satisfies CSSProperties,

  body: {
    flex: 1,
    overflow: "auto",
    padding: "24px 28px 40px",
    display: "flex",
    flexDirection: "column",
    gap: 20,
    maxWidth: 860,
  } satisfies CSSProperties,

  section: {
    background: "var(--bg-elevated)",
    border: "1px solid var(--border)",
    borderRadius: 10,
    padding: "20px 24px",
  } satisfies CSSProperties,
  sectionTitle: {
    fontSize: 16,
    fontWeight: 700,
    color: "var(--text-primary)",
    marginBottom: 10,
  } satisfies CSSProperties,
  diagramWrap: { marginTop: 14 } satisfies CSSProperties,

  emptyWrap: {
    flex: 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  } satisfies CSSProperties,

  loadingWrap: {
    padding: "24px 28px",
    display: "flex",
    flexDirection: "column",
    gap: 16,
  } satisfies CSSProperties,
} as const;
