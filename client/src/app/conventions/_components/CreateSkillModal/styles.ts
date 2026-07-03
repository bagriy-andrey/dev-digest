import type { CSSProperties } from "react";

export const s = {
  body: {
    padding: "20px 24px",
    display: "flex",
    flexDirection: "column",
    gap: 16,
    overflowY: "auto",
  } as CSSProperties,
  footer: {
    display: "flex",
    justifyContent: "flex-end",
    gap: 8,
    padding: "14px 20px",
    borderTop: "1px solid var(--border)",
  } as CSSProperties,
} as const;
