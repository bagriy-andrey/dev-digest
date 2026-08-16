import type { CSSProperties } from "react";

export const s = {
  head: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 14,
  } satisfies CSSProperties,
  title: {
    fontSize: 15,
    fontWeight: 700,
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  toggleRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
  } satisfies CSSProperties,
  toggleLabel: {
    fontSize: 13,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  group: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    padding: "12px 0",
    borderTop: "1px solid var(--border)",
  } satisfies CSSProperties,
  groupHead: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    fontSize: 13,
  } satisfies CSSProperties,
  location: {
    fontSize: 12,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  groupTitle: {
    fontSize: 13.5,
    fontWeight: 600,
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  takes: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    marginTop: 4,
  } satisfies CSSProperties,
  take: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    fontSize: 12.5,
  } satisfies CSSProperties,
  persona: {
    fontWeight: 600,
    color: "var(--text-primary)",
    minWidth: 120,
  } satisfies CSSProperties,
  ignored: {
    color: "var(--text-muted)",
    fontStyle: "italic",
  } satisfies CSSProperties,
  note: {
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  filteredEmpty: {
    fontSize: 13,
    color: "var(--text-muted)",
    padding: "12px 0",
  } satisfies CSSProperties,
} as const;
