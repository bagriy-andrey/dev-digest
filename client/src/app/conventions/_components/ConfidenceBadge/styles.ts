import type { CSSProperties } from "react";

const COLOR = {
  high: { bg: "var(--green-bg, #dcfce7)", color: "var(--green, #16a34a)" },
  medium: { bg: "var(--yellow-bg, #fef9c3)", color: "var(--yellow, #ca8a04)" },
  low: { bg: "var(--red-bg, #fee2e2)", color: "var(--red, #dc2626)" },
} satisfies Record<string, { bg: string; color: string }>;

type Tier = keyof typeof COLOR;

export const s = {
  badge(tier: Tier): CSSProperties {
    const c = COLOR[tier];
    return {
      display: "inline-block",
      padding: "2px 8px",
      borderRadius: 6,
      fontSize: 11,
      fontWeight: 600,
      background: c.bg,
      color: c.color,
    };
  },
} as const;
