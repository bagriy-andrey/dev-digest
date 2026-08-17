import type { CSSProperties } from "react";

export const s = {
  // Matches the established page-container convention (see
  // AgentsListView/styles.ts's `page`) — every other top-level route wraps
  // its content in a padded, centered max-width column instead of letting it
  // stretch edge-to-edge under the (unpadded) AppShell `<main>`.
  page: {
    padding: "24px 32px 44px",
    maxWidth: 1100,
    margin: "0 auto",
  } satisfies CSSProperties,
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
  sectionLabel: {
    fontSize: 13,
    fontWeight: 700,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
} as const;
