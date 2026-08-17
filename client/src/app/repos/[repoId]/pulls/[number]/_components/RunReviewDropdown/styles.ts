import type { CSSProperties } from "react";

/** Co-located styles for RunReviewDropdown's local checklist popover. The
   vendored `Dropdown` can't host checkboxes (see the component's own
   comment), so this is a small hand-rolled popover mirroring `Dropdown.tsx`'s
   own outside-click + positioning pattern. */
export const s = {
  wrapper: { position: "relative", display: "inline-block" },
  panel: {
    position: "absolute",
    top: "calc(100% + 6px)",
    right: 0,
    width: 0, // overridden inline with POPOVER_WIDTH
    background: "var(--bg-elevated)",
    border: "1px solid var(--border-strong)",
    borderRadius: 9,
    boxShadow: "var(--shadow-modal)",
    padding: 8,
    zIndex: 40,
    display: "flex",
    flexDirection: "column",
    gap: 2,
  },
  warningRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "6px 8px",
    fontSize: 12.5,
    color: "var(--text-secondary)",
  },
  divider: { height: 1, background: "var(--border)", margin: "6px 0" },
  agentList: { display: "flex", flexDirection: "column", gap: 2, maxHeight: 260, overflowY: "auto" },
  row: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    padding: "6px 8px",
    borderRadius: 6,
  },
  rowMain: { display: "flex", alignItems: "center", gap: 8, minWidth: 0 },
  rowName: {
    fontSize: 13,
    fontWeight: 500,
    color: "var(--text-primary)",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  rowEstimate: { fontSize: 11.5, color: "var(--text-muted)", flexShrink: 0, whiteSpace: "nowrap" },
  emptyRow: { padding: "6px 8px", fontSize: 12.5, color: "var(--text-muted)" },
  configureRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "8px 8px",
    borderRadius: 6,
    border: "none",
    background: "transparent",
    color: "var(--text-secondary)",
    fontSize: 13,
    fontWeight: 500,
    textAlign: "left",
    cursor: "pointer",
    width: "100%",
  },
  footer: { display: "flex", flexDirection: "column", gap: 6, paddingTop: 4 },
  aggregateLine: { fontSize: 11.5, color: "var(--text-muted)", padding: "0 2px" },
} satisfies Record<string, CSSProperties>;
