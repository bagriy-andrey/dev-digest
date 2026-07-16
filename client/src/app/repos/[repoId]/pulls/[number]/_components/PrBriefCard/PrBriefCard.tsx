/* PrBriefCard — shown at the top of the Overview tab, above IntentCard.
   Reads the cached PR Why + Risk Brief (never computes it) and offers a
   manual Generate/Regenerate action. Reads ONLY usePrBrief/useGenerateBrief
   — does not touch VerdictBanner/IntentCard/BlastRadiusCard state (naming-
   collision guardrail, AC-18). Renders no token/cost/model figure (AC-14 —
   that data is server-log-only, never returned by the API). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, SectionLabel, MonoLink, Icon } from "@devdigest/ui";
import { usePrBrief, useGenerateBrief } from "@/lib/hooks";
import { RISK_LEVEL_STYLE } from "./constants";
import { s } from "./styles";

interface PrBriefCardProps {
  prId: string | null;
  repoId: string;
  onOpenInDiff: (file: string, line: number | null) => void;
}

export function PrBriefCard({ prId, onOpenInDiff }: PrBriefCardProps) {
  const t = useTranslations("prReview");
  const { data: brief, isLoading } = usePrBrief(prId);
  const generate = useGenerateBrief(prId);

  const hasBrief = !!brief;
  const buttonLabel = generate.isPending
    ? t("brief.generating")
    : hasBrief
      ? t("brief.regenerate")
      : t("brief.generate");

  return (
    <section>
      <SectionLabel
        icon="FileText"
        right={
          <Button
            kind="secondary"
            size="sm"
            icon="RefreshCw"
            loading={generate.isPending}
            disabled={!prId}
            onClick={() => generate.mutate()}
          >
            {buttonLabel}
          </Button>
        }
      >
        {t("brief.label")}
      </SectionLabel>

      <div style={s.card}>
        {isLoading ? (
          <div style={s.empty}>{t("brief.loading")}</div>
        ) : !brief ? (
          <div style={s.empty}>{t("brief.empty")}</div>
        ) : (
          <>
            <div style={s.section}>
              <div style={s.sectionLabel}>{t("brief.what")}</div>
              <p style={s.bodyText}>{brief.what}</p>
            </div>

            <div style={s.section}>
              <div style={s.sectionLabel}>{t("brief.why")}</div>
              <p style={s.bodyText}>{brief.why}</p>
            </div>

            <div style={s.section}>
              <div style={s.sectionLabel}>{t("brief.riskLevel")}</div>
              <div style={s.riskLevelRow}>
                {(() => {
                  const level = RISK_LEVEL_STYLE[brief.risk_level];
                  const LevelIcon = Icon[level.icon];
                  return (
                    <span style={s.riskLevelChip(level.color, level.bg)}>
                      <LevelIcon size={12.5} />
                      {t(`brief.riskLevels.${brief.risk_level}`)}
                    </span>
                  );
                })()}
              </div>
            </div>

            {brief.risks.length > 0 && (
              <div style={s.section}>
                <div style={s.sectionLabel}>{t("brief.risks")}</div>
                <div style={s.riskList}>
                  {brief.risks.map((risk, i) => {
                    const level = RISK_LEVEL_STYLE[risk.severity];
                    const RiskIcon = Icon[level.icon];
                    return (
                      <div key={`${risk.kind}-${i}`} style={s.riskItem}>
                        <div style={s.riskItemHead}>
                          <span style={s.riskLevelChip(level.color, level.bg)}>
                            <RiskIcon size={12.5} />
                            {t(`brief.riskLevels.${risk.severity}`)}
                          </span>
                          <span style={s.riskTitle}>{risk.title}</span>
                          <span style={s.riskKind}>{risk.kind}</span>
                        </div>
                        <p style={s.riskExplanation}>{risk.explanation}</p>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {brief.review_focus.length > 0 && (
              <div style={s.section}>
                <div style={s.sectionLabel}>{t("brief.reviewFocus")}</div>
                <ul style={s.focusList}>
                  {brief.review_focus.map((item, i) => (
                    <li key={`${item.file}-${i}`} style={s.focusItem}>
                      <MonoLink onClick={() => onOpenInDiff(item.file, null)}>{item.file}</MonoLink>
                      <span style={s.focusReason}>{item.reason}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}

        {generate.isError && <div style={s.error}>{t("brief.generateError")}</div>}
      </div>
    </section>
  );
}
