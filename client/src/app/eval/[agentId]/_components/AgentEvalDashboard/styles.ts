import type { CSSProperties } from "react";
import { BATCH_HISTORY_GRID } from "./constants";

/** Co-located styles for the per-agent eval dashboard. */
export const s = {
  pageHeader: {
    padding: "16px 32px 0",
    display: "flex",
    alignItems: "center",
    gap: 12,
  } satisfies CSSProperties,
  pageTitle: {
    fontSize: 18,
    fontWeight: 700,
  } satisfies CSSProperties,
  headerActions: {
    marginLeft: "auto",
    display: "flex",
    gap: 10,
    alignItems: "center",
  } satisfies CSSProperties,
  passTotal: {
    fontSize: 13,
    color: "var(--text-secondary)",
    margin: "4px 32px 0",
  } satisfies CSSProperties,
  movementLine: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    margin: "10px 32px 0",
    fontSize: 14,
    fontWeight: 600,
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  section: {
    margin: "20px 32px",
  } satisfies CSSProperties,
  sectionTitle: {
    fontSize: 15,
    fontWeight: 700,
    marginBottom: 12,
  } satisfies CSSProperties,
  chartLegend: {
    display: "flex",
    gap: 18,
    flexWrap: "wrap",
    marginTop: 10,
    fontSize: 13,
  } satisfies CSSProperties,
  legendItem: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  legendSwatch: (color: string): CSSProperties => ({
    width: 10,
    height: 10,
    borderRadius: 99,
    background: color,
    flexShrink: 0,
  }),
  tableCard: {
    border: "1px solid var(--border)",
    borderRadius: 10,
    overflow: "hidden",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  headRow: {
    display: "grid",
    gridTemplateColumns: BATCH_HISTORY_GRID,
    gap: 10,
    padding: "10px 16px",
    borderBottom: "1px solid var(--border)",
    background: "var(--bg-surface)",
    fontSize: 11.5,
    fontWeight: 700,
    letterSpacing: "0.05em",
    color: "var(--text-muted)",
    textTransform: "uppercase",
  } satisfies CSSProperties,
  batchRow: {
    display: "grid",
    gridTemplateColumns: BATCH_HISTORY_GRID,
    alignItems: "center",
    gap: 10,
    padding: "9px 16px",
    borderBottom: "1px solid var(--border)",
    fontSize: 13,
  } satisfies CSSProperties,
  checkboxWrap: (disabled: boolean): CSSProperties => ({
    opacity: disabled ? 0.4 : 1,
    pointerEvents: disabled ? "none" : "auto",
    display: "inline-flex",
  }),
  compareBar: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "12px 16px",
    borderTop: "1px solid var(--border)",
    background: "var(--bg-surface)",
  } satisfies CSSProperties,
  disabledReason: {
    fontSize: 12.5,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  passFail: (color: string): CSSProperties => ({
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    color,
    fontWeight: 600,
  }),
  loadingStack: {
    padding: 20,
    display: "flex",
    flexDirection: "column",
    gap: 14,
  } satisfies CSSProperties,
} as const;
