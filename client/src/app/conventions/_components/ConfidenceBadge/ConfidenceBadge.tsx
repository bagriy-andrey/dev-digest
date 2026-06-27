"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { HIGH_THRESHOLD, MEDIUM_THRESHOLD } from "./constants";
import { s } from "./styles";

export function ConfidenceBadge({ confidence }: { confidence: number }) {
  const t = useTranslations("conventions");
  const pct = Math.round(confidence * 100);

  const tier: "high" | "medium" | "low" =
    confidence >= HIGH_THRESHOLD
      ? "high"
      : confidence >= MEDIUM_THRESHOLD
        ? "medium"
        : "low";

  return (
    <span style={s.badge(tier)}>
      {t(`card.confidence${tier.charAt(0).toUpperCase() + tier.slice(1)}`)} · {pct}%
    </span>
  );
}
