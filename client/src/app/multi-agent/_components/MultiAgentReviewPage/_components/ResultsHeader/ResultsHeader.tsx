/* ResultsHeader — agent count, total duration, total cost, parallel fan-out
   label (AC-36). Figures come straight off the `MultiAgentRun` response —
   the same `agent_runs`-derived numbers the drawer's Stats section reads
   (AC-41) — never a separately computed figure. Deliberately no
   worktree-isolation claim anywhere in this copy (AC-36). */
"use client";

import { useTranslations } from "next-intl";
import { Card, Icon } from "@devdigest/ui";
import type { MultiAgentRun } from "@/lib/types";
import { formatCost, formatDuration } from "@/lib/multi-agent-estimates";
import { s } from "./styles";

export function ResultsHeader({ group }: { group: MultiAgentRun }) {
  const t = useTranslations("multiAgent");
  return (
    <Card>
      <div style={s.header}>
        <div style={s.stat}>
          <span style={s.statValue}>{t("results.agentCount", { count: group.agent_count })}</span>
        </div>
        <div style={s.stat}>
          <span style={s.statLabel}>{t("results.duration")}</span>
          <span style={s.statValue}>{formatDuration(group.total_duration_ms)}</span>
        </div>
        <div style={s.stat}>
          <span style={s.statLabel}>{t("results.cost")}</span>
          <span style={s.statValue}>{formatCost(group.total_cost_usd)}</span>
        </div>
        <div style={s.fanOut}>
          <Icon.Workflow size={13} style={{ verticalAlign: "-2px", marginRight: 5 }} />
          {t("results.parallelFanOut")}
        </div>
      </div>
    </Card>
  );
}
