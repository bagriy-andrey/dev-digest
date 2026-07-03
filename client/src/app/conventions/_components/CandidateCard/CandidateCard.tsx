"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Checkbox } from "@devdigest/ui";
import type { ConventionCandidate } from "@devdigest/shared";
import { ConfidenceBadge } from "../ConfidenceBadge";
import { buildGithubUrl, truncateSnippet } from "./helpers";
import { s } from "./styles";

interface CandidateCardProps {
  candidate: ConventionCandidate;
  checked: boolean;
  onCheck: (checked: boolean) => void;
  repoFullName: string;
  repoBranch: string;
}

export function CandidateCard({
  candidate,
  checked,
  onCheck,
  repoFullName,
  repoBranch,
}: CandidateCardProps) {
  const t = useTranslations("conventions");
  const githubUrl = buildGithubUrl(repoFullName, repoBranch, candidate.evidence_path, candidate.evidence_line);

  return (
    <div style={s.card(checked)}>
      <div style={s.header}>
        <Checkbox checked={checked} onChange={onCheck} />
        <span style={s.rule}>{candidate.rule}</span>
        <ConfidenceBadge confidence={candidate.confidence} />
      </div>

      {candidate.evidence_snippet && (
        <div style={s.evidenceBlock}>
          <div style={s.evidenceLabel}>
            {t("card.evidenceLabel")}
            {githubUrl && (
              <>
                {" · "}
                <a
                  href={githubUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={s.githubLink}
                >
                  {candidate.evidence_path}
                  {candidate.evidence_line ? `:${candidate.evidence_line}` : ""}
                  {" ↗"}
                </a>
              </>
            )}
            {!githubUrl && candidate.evidence_path && (
              <span style={s.pathLabel}> · {candidate.evidence_path}</span>
            )}
          </div>
          <pre style={s.snippet}>{truncateSnippet(candidate.evidence_snippet)}</pre>
        </div>
      )}
    </div>
  );
}
