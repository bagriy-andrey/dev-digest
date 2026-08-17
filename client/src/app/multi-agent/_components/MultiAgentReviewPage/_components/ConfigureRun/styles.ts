import type { CSSProperties } from "react";

export const s = {
  stack: {
    display: "flex",
    flexDirection: "column",
    gap: 24,
  } satisfies CSSProperties,
  stepLabel: {
    fontSize: 13,
    fontWeight: 700,
    letterSpacing: "0.03em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
    marginBottom: 10,
  } satisfies CSSProperties,
  pickerWrap: {
    maxWidth: 480,
  } satisfies CSSProperties,
  checklistCard: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
  } satisfies CSSProperties,
  checklistHead: {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    paddingBottom: 10,
    marginBottom: 6,
    borderBottom: "1px solid var(--border)",
  } satisfies CSSProperties,
  row: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "10px 4px",
    borderBottom: "1px solid var(--border)",
  } satisfies CSSProperties,
  rowMain: {
    flex: 1,
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: 2,
  } satisfies CSSProperties,
  rowName: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 14,
    fontWeight: 600,
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  rowDescription: {
    fontSize: 12.5,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  rowEstimate: {
    fontSize: 12,
    color: "var(--text-muted)",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  footer: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
    marginTop: 16,
  } satisfies CSSProperties,
  aggregateLine: {
    fontSize: 13,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
} as const;
