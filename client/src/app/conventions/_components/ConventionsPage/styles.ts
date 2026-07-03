import type { CSSProperties } from "react";

export const s = {
  root: {
    display: "flex",
    flexDirection: "column",
    gap: 20,
    padding: "24px 28px",
    maxWidth: 860,
  } as CSSProperties,
  header: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
  } as CSSProperties,
  headerText: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
  } as CSSProperties,
  title: {
    margin: 0,
    fontSize: 22,
    fontWeight: 700,
    color: "var(--text-primary)",
  } as CSSProperties,
  subtitle: {
    margin: 0,
    fontSize: 13,
    color: "var(--text-secondary)",
  } as CSSProperties,
  toolbar: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap" as const,
  } as CSSProperties,
  list: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
  } as CSSProperties,
  countLabel: {
    margin: 0,
    fontSize: 12,
    color: "var(--text-secondary)",
  } as CSSProperties,
  extractorError: {
    padding: "10px 14px",
    borderRadius: 8,
    background: "var(--red-bg, #fee2e2)",
    color: "var(--red, #dc2626)",
    fontSize: 13,
  } as CSSProperties,
} as const;
