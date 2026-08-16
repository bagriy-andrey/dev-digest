import type { CSSProperties } from "react";

export const s = {
  pageHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 20,
    gap: 12,
    flexWrap: "wrap",
  } satisfies CSSProperties,
  pageTitle: {
    fontSize: 20,
    fontWeight: 700,
    color: "var(--text-primary)",
    margin: 0,
  } satisfies CSSProperties,
  loadingStack: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
  } satisfies CSSProperties,
  resultsStack: {
    display: "flex",
    flexDirection: "column",
    gap: 20,
  } satisfies CSSProperties,
  viewToggleRow: {
    display: "flex",
    justifyContent: "flex-end",
  } satisfies CSSProperties,
} as const;
