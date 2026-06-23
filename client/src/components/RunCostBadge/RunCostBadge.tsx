/* RunCostBadge — the one place per-run cost is rendered. Two variants:
   - "compact"     → just "$0.012"            (PR list COST column)
   - "withTokens"  → "8.2K→1.3K · $0.013"     (PR detail run timeline)
   No-data cost ("—") is handled by formatCurrency; never shows "$0.00". */
"use client";

import React from "react";
import { formatCurrency, formatCompactTokens } from "@/lib/format";

export function RunCostBadge({
  usd,
  variant = "compact",
  tokensIn,
  tokensOut,
  style,
}: {
  usd: number | null | undefined;
  variant?: "compact" | "withTokens";
  tokensIn?: number | null;
  tokensOut?: number | null;
  style?: React.CSSProperties;
}) {
  const cost = formatCurrency(usd);

  if (variant === "withTokens") {
    const toks = formatCompactTokens(tokensIn, tokensOut);
    return (
      <span
        className="tnum"
        style={{ fontSize: 11, color: "var(--text-muted)", ...style }}
      >
        {toks ? `${toks} · ` : ""}
        {cost}
      </span>
    );
  }

  return (
    <span
      className="mono tnum"
      style={{ fontSize: 12.5, color: "var(--text-secondary)", ...style }}
    >
      {cost}
    </span>
  );
}
