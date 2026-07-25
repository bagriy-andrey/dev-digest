/* RiskAreasCard — shown under IntentCard, in the left column of the Overview
   grid. Reads the same cached Brief as PrBriefCard (`usePrBrief`, TanStack
   Query dedups the request) but renders ONLY `brief.risks`, as compact
   collapsible rows: severity icon, title, clickable file_refs, and a chevron
   that reveals the explanation. Never generates and renders nothing (not
   even an empty state) when there's no brief yet or it has zero risks —
   PrBriefCard already owns the Generate/empty-state affordance. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { SectionLabel, MonoLink, Icon } from "@devdigest/ui";
import { usePrBrief } from "@/lib/hooks";
import { RISK_LEVEL_STYLE } from "../PrBriefCard/constants";
import { s } from "./styles";

interface RiskAreasCardProps {
  prId: string | null;
  onOpenInDiff: (file: string, line: number | null) => void;
}

export function RiskAreasCard({ prId, onOpenInDiff }: RiskAreasCardProps) {
  const t = useTranslations("prReview");
  const { data: brief } = usePrBrief(prId);
  const [expanded, setExpanded] = React.useState<number | null>(null);

  if (!brief || brief.risks.length === 0) return null;

  return (
    <section>
      <SectionLabel icon="AlertTriangle">{t("riskAreas.label")}</SectionLabel>
      <div style={s.card}>
        {brief.risks.map((risk, i) => {
          const level = RISK_LEVEL_STYLE[risk.severity];
          const RiskIcon = Icon[level.icon];
          const isOpen = expanded === i;
          return (
            <div key={`${risk.kind}-${i}`} style={s.item}>
              <button
                type="button"
                onClick={() => setExpanded(isOpen ? null : i)}
                style={s.itemHeader}
              >
                <span style={s.iconBox(level.color, level.bg)}>
                  <RiskIcon size={13} />
                </span>
                <span style={s.itemTitle}>{risk.title}</span>
                <Icon.ChevronDown size={14} style={s.chevron(isOpen)} />
              </button>
              {risk.file_refs.length > 0 && (
                <div style={s.fileRefs}>
                  {risk.file_refs.map((f) => (
                    <MonoLink key={f} onClick={() => onOpenInDiff(f, null)}>
                      {f}
                    </MonoLink>
                  ))}
                </div>
              )}
              {isOpen && <p style={s.explanation}>{risk.explanation}</p>}
            </div>
          );
        })}
      </div>
    </section>
  );
}
