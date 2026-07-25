"use client";

import React from "react";
import { SectionLabel } from "@devdigest/ui";
import { PrBriefCard, type LatestReviewSummary } from "../PrBriefCard";
import { IntentCard } from "../IntentCard";
import { RiskAreasCard } from "../RiskAreasCard";
import { BlastRadiusCard } from "../BlastRadiusCard";
import { ReviewFocusSection } from "../ReviewFocusSection";
import { s } from "./styles";

interface OverviewTabProps {
  prBody: string | null | undefined;
  prId: string | null;
  repoId: string;
  onOpenInDiff: (file: string, line: number | null) => void;
  /** Most recent review run (any agent) — surfaced via VerdictBanner at the
   *  top of PrBriefCard. `null`/omitted when no review has completed yet. */
  latestReview?: LatestReviewSummary | null;
}

export function OverviewTab({ prBody, prId, repoId, onOpenInDiff, latestReview }: OverviewTabProps) {
  return (
    <>
      <PrBriefCard prId={prId} repoId={repoId} latestReview={latestReview} />

      <div style={s.grid}>
        <div style={s.gridCol}>
          <IntentCard prId={prId} repoId={repoId} />
          <RiskAreasCard prId={prId} onOpenInDiff={onOpenInDiff} />
        </div>
        <BlastRadiusCard prId={prId} repoId={repoId} onOpenInDiff={onOpenInDiff} />
      </div>

      <ReviewFocusSection prId={prId} onOpenInDiff={onOpenInDiff} />

      {prBody && (
        <section>
          <SectionLabel icon="MessageSquare">Description</SectionLabel>
          <div style={s.descriptionBox}>{prBody}</div>
        </section>
      )}
    </>
  );
}
