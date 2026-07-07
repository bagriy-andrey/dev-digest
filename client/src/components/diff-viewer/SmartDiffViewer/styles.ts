import type { CSSProperties } from "react";

/** Co-located styles for the SmartDiffViewer. */
export const s = {
  section: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
  } satisfies CSSProperties,
  sectionHeader: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    cursor: "pointer",
    padding: "4px 0",
  } satisfies CSSProperties,
  sectionRole: {
    fontSize: 13,
    fontWeight: 600,
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  sectionDescription: {
    fontSize: 12,
    color: "var(--text-muted)",
    flex: 1,
  } satisfies CSSProperties,
  sectionCount: {
    fontSize: 12,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  splitBanner: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 12,
    color: "var(--warning-text, var(--accent-text))",
    background: "var(--warning-bg, var(--accent-bg))",
    border: "1px solid var(--border)",
    borderRadius: 7,
    padding: "8px 12px",
  } satisfies CSSProperties,
} as const;

/** Chevron rotates 90deg when a section is expanded. */
export function chevronForSection(open: boolean): CSSProperties {
  return {
    color: "var(--text-muted)",
    transform: open ? "rotate(90deg)" : "none",
    transition: "transform .12s",
  };
}
