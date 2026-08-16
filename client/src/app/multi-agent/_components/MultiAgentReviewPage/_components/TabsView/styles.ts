import type { CSSProperties } from "react";

export const s = {
  body: {
    display: "flex",
    gap: 20,
    marginTop: 14,
  } satisfies CSSProperties,
  list: {
    flex: "0 0 320px",
    display: "flex",
    flexDirection: "column",
    gap: 6,
  } satisfies CSSProperties,
  findingRow: (selected: boolean): CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "9px 10px",
    borderRadius: 6,
    border: "1px solid " + (selected ? "var(--accent)" : "var(--border)"),
    background: selected ? "var(--bg-hover)" : "var(--bg-elevated)",
    cursor: "pointer",
    textAlign: "left",
    width: "100%",
  }),
  findingRowTitle: {
    fontSize: 13,
    fontWeight: 600,
    color: "var(--text-primary)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  detail: {
    flex: 1,
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: 12,
  } satisfies CSSProperties,
  detailTitle: {
    fontSize: 15,
    fontWeight: 700,
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  detailLabel: {
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  detailText: {
    fontSize: 13.5,
    lineHeight: 1.6,
    color: "var(--text-secondary)",
    whiteSpace: "pre-wrap",
  } satisfies CSSProperties,
  actions: {
    display: "flex",
    gap: 8,
    flexWrap: "wrap",
    marginTop: 4,
  } satisfies CSSProperties,
  hint: {
    fontSize: 11.5,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  emptyDetail: {
    fontSize: 13,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
} as const;
