"use client";

import React from "react";
import { SectionLabel } from "@devdigest/ui";
import { PrBriefCard } from "../PrBriefCard";
import { IntentCard } from "../IntentCard";
import { BlastRadiusCard } from "../BlastRadiusCard";
import { s } from "./styles";

interface OverviewTabProps {
  prBody: string | null | undefined;
  prId: string | null;
  repoId: string;
  onOpenInDiff: (file: string, line: number | null) => void;
}

export function OverviewTab({ prBody, prId, repoId, onOpenInDiff }: OverviewTabProps) {
  return (
    <>
      <PrBriefCard prId={prId} repoId={repoId} onOpenInDiff={onOpenInDiff} />
      <IntentCard prId={prId} repoId={repoId} />
      <BlastRadiusCard prId={prId} repoId={repoId} onOpenInDiff={onOpenInDiff} />

      {prBody && (
        <section>
          <SectionLabel icon="MessageSquare">Description</SectionLabel>
          <div style={s.descriptionBox}>{prBody}</div>
        </section>
      )}
    </>
  );
}
