import type { CSSProperties } from "react";

export const s = {
  root: { display: "flex", height: "calc(100vh - 52px)" } satisfies CSSProperties,

  // left panel
  left: {
    width: 300,
    flexShrink: 0,
    borderRight: "1px solid var(--border)",
    display: "flex",
    flexDirection: "column",
    background: "var(--bg-surface)",
    overflow: "hidden",
  } satisfies CSSProperties,
  leftHeader: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "16px 16px 12px",
    borderBottom: "1px solid var(--border)",
    flexShrink: 0,
  } satisfies CSSProperties,
  leftTitle: { fontSize: 18, fontWeight: 700, flex: 1 } satisfies CSSProperties,
  searchWrap: { padding: "10px 12px", flexShrink: 0 } satisfies CSSProperties,
  list: { flex: 1, overflow: "auto", padding: "4px 8px 12px" } satisfies CSSProperties,

  // right panel
  right: { flex: 1, display: "flex", flexDirection: "column", minWidth: 0, overflow: "hidden" } satisfies CSSProperties,

  // skill card
  card: {
    padding: "12px 14px",
    borderRadius: 8,
    cursor: "pointer",
    marginBottom: 4,
    border: "1px solid transparent",
    transition: "background .1s, border-color .1s",
  } satisfies CSSProperties,
  cardActive: { background: "var(--bg-elevated)", borderColor: "var(--accent)" } satisfies CSSProperties,
  cardInactive: { background: "transparent", borderColor: "transparent" } satisfies CSSProperties,
  cardTop: { display: "flex", alignItems: "center", gap: 8, marginBottom: 4 } satisfies CSSProperties,
  cardName: { flex: 1, fontFamily: "var(--font-mono, monospace)", fontSize: 13, fontWeight: 600 } satisfies CSSProperties,
  cardDesc: {
    fontSize: 12,
    color: "var(--text-secondary)",
    marginBottom: 6,
    display: "-webkit-box",
    WebkitLineClamp: 2,
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
  } satisfies CSSProperties,
  cardBadges: { display: "flex", gap: 6, marginBottom: 6 } satisfies CSSProperties,
  cardStats: { fontSize: 11, color: "var(--text-muted)", display: "flex", gap: 10 } satisfies CSSProperties,

  // detail panel header
  detailHeader: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "16px 24px",
    borderBottom: "1px solid var(--border)",
    flexShrink: 0,
  } satisfies CSSProperties,
  detailTitle: { fontSize: 16, fontWeight: 700 } satisfies CSSProperties,
  detailBody: { flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" } satisfies CSSProperties,
  detailTabBody: { flex: 1, overflow: "auto", padding: 28 } satisfies CSSProperties,

  // config tab
  bodyEditorWrap: {
    border: "1px solid var(--border-strong)",
    borderRadius: 8,
    overflow: "hidden",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  bodyEditorHeader: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "8px 14px",
    borderBottom: "1px solid var(--border)",
    background: "var(--bg-primary)",
    fontSize: 12,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  bodyActions: { display: "flex", gap: 8, marginTop: 16 } satisfies CSSProperties,

  // preview tab
  previewCard: {
    background: "var(--bg-canvas, #fff)",
    color: "#111",
    borderRadius: 10,
    padding: "28px 32px",
    maxWidth: 720,
    fontSize: 14,
    lineHeight: 1.65,
  } satisfies CSSProperties,
  previewSubtitle: { fontSize: 13, color: "var(--text-secondary)", marginBottom: 20 } satisfies CSSProperties,

  // stats tab
  metricsRow: { display: "flex", gap: 14, marginBottom: 28 } satisfies CSSProperties,
  statsGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 } satisfies CSSProperties,
  statsSection: {
    background: "var(--bg-elevated)",
    border: "1px solid var(--border)",
    borderRadius: 9,
    padding: 20,
  } satisfies CSSProperties,
  statsSectionLabel: {
    fontSize: 11,
    fontWeight: 700,
    color: "var(--text-muted)",
    letterSpacing: "0.06em",
    marginBottom: 14,
  } satisfies CSSProperties,
  agentRow: {
    display: "flex",
    alignItems: "center",
    padding: "8px 0",
    borderBottom: "1px solid var(--border)",
    fontSize: 14,
  } satisfies CSSProperties,

  // versions tab
  versionRow: {
    display: "flex",
    alignItems: "center",
    gap: 14,
    padding: "12px 0",
    borderBottom: "1px solid var(--border)",
    cursor: "pointer",
    fontSize: 13,
  } satisfies CSSProperties,

  // skills tab (agent editor)
  skillsTabRoot: { display: "flex", flexDirection: "column", gap: 0 } satisfies CSSProperties,
  skillsTabHeader: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    marginBottom: 6,
    paddingBottom: 10,
    borderBottom: "1px solid var(--border)",
  } satisfies CSSProperties,
  skillRow: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "10px 4px",
    borderBottom: "1px solid var(--border)",
    fontSize: 13,
  } satisfies CSSProperties,
} as const;
