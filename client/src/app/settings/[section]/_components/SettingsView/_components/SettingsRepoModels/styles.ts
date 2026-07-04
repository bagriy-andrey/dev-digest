import type { CSSProperties } from "react";

/** Co-located styles for SettingsRepoModels (per-repo Intent model override). */
export const s = {
  wrap: { maxWidth: 640, marginTop: 28 } satisfies CSSProperties,
  row: { marginBottom: 18 } satisfies CSSProperties,
  defaultTag: {
    marginLeft: 8,
    fontSize: 12,
    fontWeight: 500,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
} as const;
