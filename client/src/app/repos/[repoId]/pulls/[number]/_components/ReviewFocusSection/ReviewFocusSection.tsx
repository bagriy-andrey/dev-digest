/* ReviewFocusSection — full-width section below the Intent/Blast Radius grid
   on Overview. Reads the same cached Brief as PrBriefCard/RiskAreasCard
   (`usePrBrief`, TanStack Query dedups the request) but renders ONLY
   `brief.review_focus`, one line per item (bullet, clickable file, reason).
   Renders nothing when there's no brief yet or it has zero focus items. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { SectionLabel, MonoLink, Icon, Badge } from "@devdigest/ui";
import { usePrBrief } from "@/lib/hooks";
import { s } from "./styles";

interface ReviewFocusSectionProps {
  prId: string | null;
  onOpenInDiff: (file: string, line: number | null) => void;
}

export function ReviewFocusSection({ prId, onOpenInDiff }: ReviewFocusSectionProps) {
  const t = useTranslations("prReview");
  const { data: brief } = usePrBrief(prId);

  if (!brief || brief.review_focus.length === 0) return null;

  return (
    <section>
      <SectionLabel icon="ListChecks" right={<Badge>{brief.review_focus.length}</Badge>}>
        {t("brief.reviewFocus")}
      </SectionLabel>
      <div style={s.card}>
        <ul style={s.list}>
          {brief.review_focus.map((item, i) => (
            <li key={`${item.file}-${i}`} style={s.item}>
              <Icon.ChevronRight size={13} style={s.bulletIcon} />
              <MonoLink onClick={() => onOpenInDiff(item.file, null)}>{item.file}</MonoLink>
              <span style={s.dash}>—</span>
              <span style={s.reason}>{item.reason}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
