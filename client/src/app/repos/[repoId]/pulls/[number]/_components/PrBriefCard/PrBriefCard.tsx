/* PrBriefCard — shown at the top of the Overview tab. Reads the cached PR
   Why + Risk Brief (never computes it) and offers a manual Generate/
   Regenerate action. Reads ONLY usePrBrief/useGenerateBrief for its own
   content — does not touch IntentCard/BlastRadiusCard state (naming-
   collision guardrail, AC-18). Renders no token/cost/model figure for the
   BRIEF itself (AC-14 — that data is server-log-only, never returned by the
   API); the optional `latestReview` prop instead surfaces the most recent
   review RUN's verdict/score via the existing VerdictBanner, so the top of
   Overview reads as one unified "PR Brief" panel (verdict + narrative). Risk
   Areas (`brief.risks`) and Review Focus (`brief.review_focus`) render in
   their own sections elsewhere on Overview (RiskAreasCard/ReviewFocusSection)
   — not nested in this card. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, SectionLabel, Icon } from "@devdigest/ui";
import type { Verdict } from "@devdigest/shared";
import { usePrBrief, useGenerateBrief } from "@/lib/hooks";
import { VerdictBanner } from "../VerdictBanner";
import { RISK_LEVEL_STYLE } from "./constants";
import { s } from "./styles";

export interface LatestReviewSummary {
  verdict: Verdict;
  summary: string | null;
  score: number | null;
  findingsCount: number;
  blockers: number;
  agentName?: string | null;
}

interface PrBriefCardProps {
  prId: string | null;
  repoId: string;
  /** Most recent review run (any agent) — renders as a VerdictBanner above
   *  the brief text. `null` when no review has completed yet. */
  latestReview?: LatestReviewSummary | null;
}

export function PrBriefCard({ prId, latestReview }: PrBriefCardProps) {
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

      {latestReview && (
        <div style={s.verdictWrap}>
          <VerdictBanner
            verdict={latestReview.verdict}
            summary={latestReview.summary}
            score={latestReview.score}
            findingsCount={latestReview.findingsCount}
            blockers={latestReview.blockers}
            agentName={latestReview.agentName}
          />
        </div>
      )}

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
          </>
        )}

        {generate.isError && <div style={s.error}>{t("brief.generateError")}</div>}
      </div>
    </section>
  );
}
