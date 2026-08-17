/* ColumnsView — one column per agent (AC-34). Findings arrive already
   severity-ordered from the server (sortFindingsBySeverity), so this is a
   pure render, no client-side re-sort. Status and severity both carry a
   text/icon cue, never colour alone (a11y). The strip scrolls horizontally
   at narrow widths with 3+ agents rather than clipping. */
"use client";

import { useTranslations } from "next-intl";
import { Button, Card, Icon, SeverityBadge } from "@devdigest/ui";
import type { AgentColumn } from "@/lib/types";
import { formatCost, formatDuration } from "@/lib/multi-agent-estimates";
import { STATUS_COLOR, STATUS_ICON } from "./constants";
import { s } from "./styles";

export function ColumnsView({
  columns,
  onOpenTrace,
}: {
  columns: AgentColumn[];
  onOpenTrace: (column: AgentColumn) => void;
}) {
  const t = useTranslations("multiAgent");
  return (
    <div style={s.strip}>
      {columns.map((column) => {
        const StatusIcon = Icon[STATUS_ICON[column.status]];
        return (
          <Card key={column.run_id} style={s.column}>
            <div style={s.columnHead}>
              <span style={s.agentName}>{column.agent_name}</span>
              <span style={s.statusRow(STATUS_COLOR[column.status])}>
                <StatusIcon size={13} aria-hidden="true" />
                {t(`results.status.${column.status}`)}
              </span>
              <div style={s.metaRow}>
                <span>{formatDuration(column.duration_ms)}</span>
                <span>{formatCost(column.cost_usd)}</span>
              </div>
              <Button kind="ghost" size="sm" icon="Eye" onClick={() => onOpenTrace(column)}>
                {t("results.viewTrace")}
              </Button>
            </div>

            {column.status === "failed" && column.summary && (
              <div style={s.summary}>{column.summary}</div>
            )}

            <div style={s.findingsStack}>
              {column.findings.length === 0 ? (
                <div style={s.emptyFindings}>{t("results.noFindings")}</div>
              ) : (
                column.findings.map((finding) => (
                  <div key={finding.id} style={s.finding}>
                    <SeverityBadge severity={finding.severity} compact />
                    <span style={s.findingTitle}>{finding.title}</span>
                    <span style={s.findingLocation}>
                      {finding.file}:{finding.start_line}
                    </span>
                  </div>
                ))
              )}
            </div>
          </Card>
        );
      })}
    </div>
  );
}
