/* TabsView — one tab per agent (AC-35). Selecting a finding opens a detail
   panel sourced from `usePrReviews` (the existing hook — `AgentColumnFinding`
   is deliberately not widened with confidence/rationale/suggestion).
   Untrusted content (title/rationale/suggestion) is rendered as plain text —
   no markdown/HTML parsing, no field used to build a URL or drive
   navigation. Accept/Dismiss hit the existing finding-action endpoints;
   Learn / Turn into eval case are disabled with a programmatically
   associated "coming soon" explanation (AC-38). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Card, ConfidenceNum, SeverityBadge, Tabs } from "@devdigest/ui";
import type { AgentColumn, ReviewRecord } from "@/lib/types";
import { useFindingAction } from "@/lib/hooks";
import { findFindingRecord } from "./helpers";
import { s } from "./styles";

const LEARN_HINT_ID = "multi-agent-learn-hint";

export function TabsView({
  columns,
  reviews,
  prId,
  onOpenTrace,
}: {
  columns: AgentColumn[];
  reviews: ReviewRecord[] | undefined;
  prId: string;
  onOpenTrace: (column: AgentColumn) => void;
}) {
  const t = useTranslations("multiAgent");
  const findingAction = useFindingAction();
  const [activeRunId, setActiveRunId] = React.useState<string | null>(null);
  const [selectedFindingId, setSelectedFindingId] = React.useState<string | null>(null);

  const activeColumn = columns.find((c) => c.run_id === activeRunId) ?? columns[0] ?? null;
  const selectedFinding = findFindingRecord(reviews, selectedFindingId);

  const selectTab = (runId: string) => {
    setActiveRunId(runId);
    setSelectedFindingId(null);
  };

  if (!activeColumn) return null;

  return (
    <Card>
      <Tabs
        tabs={columns.map((c) => ({ key: c.run_id, label: c.agent_name }))}
        value={activeColumn.run_id}
        onChange={selectTab}
        pad="0"
      />

      <div style={s.body}>
        <div style={s.list}>
          <Button kind="ghost" size="sm" icon="Eye" onClick={() => onOpenTrace(activeColumn)}>
            {t("results.viewTrace")}
          </Button>
          {activeColumn.findings.length === 0 ? (
            <div style={s.emptyDetail}>{t("results.noFindings")}</div>
          ) : (
            activeColumn.findings.map((finding) => (
              <button
                key={finding.id}
                type="button"
                style={s.findingRow(finding.id === selectedFindingId)}
                onClick={() => setSelectedFindingId(finding.id)}
              >
                <SeverityBadge severity={finding.severity} compact />
                <span style={s.findingRowTitle}>{finding.title}</span>
              </button>
            ))
          )}
        </div>

        <div style={s.detail}>
          {!selectedFinding ? (
            <div style={s.emptyDetail}>{t("detail.selectFinding")}</div>
          ) : (
            <>
              <div style={s.detailTitle}>{selectedFinding.title}</div>
              <ConfidenceNum value={selectedFinding.confidence} />
              <div style={s.detailText}>{selectedFinding.rationale}</div>
              {selectedFinding.suggestion && (
                <>
                  <div style={s.detailLabel}>{t("detail.suggestion")}</div>
                  <div style={s.detailText}>{selectedFinding.suggestion}</div>
                </>
              )}
              <div style={s.actions}>
                <Button
                  kind="secondary"
                  size="sm"
                  icon="Check"
                  active={!!selectedFinding.accepted_at}
                  disabled={findingAction.isPending}
                  onClick={() =>
                    findingAction.mutate({ findingId: selectedFinding.id, action: "accept", prId })
                  }
                >
                  {t("detail.accept")}
                </Button>
                <Button
                  kind="ghost"
                  size="sm"
                  icon="X"
                  active={!!selectedFinding.dismissed_at}
                  disabled={findingAction.isPending}
                  onClick={() =>
                    findingAction.mutate({ findingId: selectedFinding.id, action: "dismiss", prId })
                  }
                >
                  {t("detail.dismiss")}
                </Button>
                <Button kind="ghost" size="sm" disabled aria-describedby={LEARN_HINT_ID}>
                  {t("detail.learn")}
                </Button>
                <Button kind="ghost" size="sm" icon="FlaskConical" disabled aria-describedby={LEARN_HINT_ID}>
                  {t("detail.evalCase")}
                </Button>
              </div>
              <span id={LEARN_HINT_ID} style={s.hint}>
                {t("detail.comingSoon")}
              </span>
            </>
          )}
        </div>
      </div>
    </Card>
  );
}
