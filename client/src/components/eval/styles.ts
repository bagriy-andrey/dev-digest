import type { CSSProperties } from "react";

/** Co-located styles for `MetricStrip`/`DeltaChip`. */
export const s = {
  strip: {
    display: "flex",
    gap: 12,
    flexWrap: "wrap",
  } satisfies CSSProperties,
  chip: (color: string): CSSProperties => ({
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    fontSize: 12,
    fontWeight: 600,
    color,
  }),
} as const;
