/* RecentRunsList — the /multi-agent landing list (no `?pr=` selected yet):
   the N most recent multi-agent groups across every PR in the workspace,
   newest first. Each row is a lightweight `MultiAgentGroupSummary` (no
   columns/conflicts — those only load once a specific group is opened).
   Clicking a row navigates to that group's results (`?pr=<id>`). */
"use client";

import { useTranslations } from "next-intl";
import { Badge, Card } from "@devdigest/ui";
import type { MultiAgentGroupSummary } from "@/lib/types";
import { formatCost, formatDuration } from "@/lib/multi-agent-estimates";
import { GROUP_STATUS } from "./constants";
import { s } from "./styles";

export function RecentRunsList({
  groups,
  onOpenGroup,
}: {
  groups: MultiAgentGroupSummary[];
  onOpenGroup: (prId: string) => void;
}) {
  const t = useTranslations("multiAgent");
  return (
    <div style={s.list}>
      {groups.map((g) => {
        const status = GROUP_STATUS[g.status];
        return (
          <Card key={g.id} pad={false} hover onClick={() => onOpenGroup(g.pr_id)}>
            <div style={s.row}>
              <Badge color={status.color} bg={status.bg} icon={status.icon}>
                {t(`results.status.${g.status}`)}
              </Badge>
              <div style={s.main}>
                <div style={s.prTitle}>
                  <span className="mono" style={s.prNumber}>
                    #{g.pr_number}
                  </span>
                  {g.pr_title}
                </div>
                <div style={s.meta}>
                  {t("results.agentCount", { count: g.agent_count })} ·{" "}
                  {formatDuration(g.total_duration_ms)} · {formatCost(g.total_cost_usd)}
                </div>
              </div>
              <span style={s.time}>{new Date(g.ran_at).toLocaleString()}</span>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
