import type { CSSProperties } from "react";

/** Co-located styles for BlastGraph (fixed column node-link diagram). */
export const s = {
  svg: {
    display: "block",
  } satisfies CSSProperties,
  edge: {
    stroke: "var(--border-strong)",
    strokeWidth: 1.25,
  } satisfies CSSProperties,
  edgeImpact: {
    stroke: "var(--accent, var(--border-strong))",
    strokeWidth: 1,
    strokeDasharray: "3 3",
  } satisfies CSSProperties,
  edgeMore: {
    stroke: "var(--border-strong)",
    strokeWidth: 1,
    strokeDasharray: "2 2",
    opacity: 0.6,
  } satisfies CSSProperties,
  clickable: {
    cursor: "pointer",
  } satisfies CSSProperties,
  symbolRect: {
    fill: "var(--bg-elevated)",
    stroke: "var(--text-primary)",
  } satisfies CSSProperties,
  symbolText: {
    fill: "var(--text-primary)",
    fontSize: 12,
    fontWeight: 700,
  } satisfies CSSProperties,
  callerRect: {
    fill: "var(--bg-elevated)",
    stroke: "var(--border-strong)",
  } satisfies CSSProperties,
  callerText: {
    fill: "var(--text-secondary)",
    fontSize: 11,
  } satisfies CSSProperties,
  impactRect: {
    fill: "var(--accent-bg, var(--bg-hover))",
    stroke: "var(--accent-text, var(--border-strong))",
  } satisfies CSSProperties,
  impactText: {
    fill: "var(--accent-text)",
    fontSize: 11,
    fontWeight: 600,
  } satisfies CSSProperties,
  moreRect: {
    fill: "none",
    stroke: "var(--border)",
    strokeDasharray: "3 3",
  } satisfies CSSProperties,
  moreText: {
    fill: "var(--text-muted)",
    fontSize: 11,
    fontStyle: "italic",
  } satisfies CSSProperties,
} as const;
