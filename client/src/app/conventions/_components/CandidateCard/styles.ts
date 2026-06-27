import type { CSSProperties } from "react";

export const s = {
  card(checked: boolean): CSSProperties {
    return {
      background: checked ? "var(--accent-bg)" : "var(--bg-elevated)",
      border: `1.5px solid ${checked ? "var(--accent)" : "var(--border-strong)"}`,
      borderRadius: 10,
      padding: "14px 16px",
      display: "flex",
      flexDirection: "column",
      gap: 10,
      transition: "border-color .15s, background .15s",
    };
  },
  header: {
    display: "flex",
    alignItems: "flex-start",
    gap: 10,
  } as CSSProperties,
  rule: {
    flex: 1,
    fontSize: 14,
    fontWeight: 500,
    color: "var(--text-primary)",
    lineHeight: 1.4,
  } as CSSProperties,
  evidenceBlock: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    marginLeft: 26,
  } as CSSProperties,
  evidenceLabel: {
    fontSize: 12,
    color: "var(--text-secondary)",
    fontWeight: 500,
  } as CSSProperties,
  githubLink: {
    color: "var(--accent)",
    textDecoration: "none",
    fontFamily: "var(--font-mono, monospace)",
  } as CSSProperties,
  pathLabel: {
    fontFamily: "var(--font-mono, monospace)",
    fontSize: 11,
  } as CSSProperties,
  snippet: {
    margin: 0,
    padding: "8px 12px",
    background: "var(--bg-page)",
    border: "1px solid var(--border)",
    borderRadius: 6,
    fontSize: 12,
    fontFamily: "var(--font-mono, monospace)",
    overflowX: "auto",
    whiteSpace: "pre",
    color: "var(--text-primary)",
    lineHeight: 1.5,
  } as CSSProperties,
} as const;
