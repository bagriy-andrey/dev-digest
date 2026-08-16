/* ConfigureRun — step 1 (pick a PR) + step 2 (choose agents) of the
   Configure-run view (AC-6, AC-7). Step 2 renders as a disabled empty state
   until a PR is selected; once one is, it's a checklist with per-agent
   estimates + an aggregate line, mirroring the PR-page picker's math
   (lib/multi-agent-estimates.ts) but as a full page, not a popover. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import {
  Button,
  Card,
  Checkbox,
  EmptyState,
  Icon,
  SearchableSelect,
} from "@devdigest/ui";
import type { Agent } from "@devdigest/shared";
import type { PrMeta } from "@/lib/types";
import { useActiveRepo } from "@/lib/repo-context";
import { useAgentRunEstimates, useAgents, usePulls, useStartMultiAgentRun } from "@/lib/hooks";
import { notify } from "@/lib/toast";
import {
  aggregateEstimate,
  estimateFor,
  formatCost,
  formatDuration,
} from "@/lib/multi-agent-estimates";
import { sortAgentsByName, toggleId } from "./helpers";
import { s } from "./styles";

export function ConfigureRun({
  selectedPrId,
  onSelectPr,
}: {
  selectedPrId: string | null;
  onSelectPr: (prId: string) => void;
}) {
  const t = useTranslations("multiAgent");
  const { repoId } = useActiveRepo();
  const { data: pulls } = usePulls(repoId);
  const { data: agents } = useAgents();
  const { data: estimates } = useAgentRunEstimates();
  const startRun = useStartMultiAgentRun();
  const [selectedAgentIds, setSelectedAgentIds] = React.useState<Set<string>>(new Set());

  const prOptions = React.useMemo(
    () =>
      (pulls ?? [])
        .filter((p): p is PrMeta & { id: string } => !!p.id)
        .map((p) => ({ value: p.id, label: `#${p.number} ${p.title}` })),
    [pulls]
  );

  const sortedAgents: Agent[] = React.useMemo(() => sortAgentsByName(agents ?? []), [agents]);
  const allSelected = sortedAgents.length > 0 && sortedAgents.every((a) => selectedAgentIds.has(a.id));
  const selectedIds = React.useMemo(() => [...selectedAgentIds], [selectedAgentIds]);
  const aggregate = React.useMemo(
    () => aggregateEstimate(estimates ?? [], selectedIds),
    [estimates, selectedIds]
  );

  const toggleAll = () => {
    setSelectedAgentIds(allSelected ? new Set() : new Set(sortedAgents.map((a) => a.id)));
  };

  const handleRun = () => {
    // Guard belongs in the handler, not just the `disabled` attribute — CSS/
    // disabled state alone is not a reliable request guard (client insights).
    if (!selectedPrId || selectedAgentIds.size === 0 || startRun.isPending) return;
    startRun.mutate(
      { prId: selectedPrId, agentIds: selectedIds },
      { onError: () => notify.error(t("configure.startError")) }
    );
  };

  return (
    <div style={s.stack}>
      <div>
        <div style={s.stepLabel}>{t("configure.step1")}</div>
        <div style={s.pickerWrap}>
          <SearchableSelect
            value={selectedPrId ?? ""}
            onChange={onSelectPr}
            options={prOptions}
            placeholder={t("configure.pickPr")}
            mono={false}
          />
        </div>
      </div>

      <div>
        <div style={s.stepLabel}>{t("configure.step2")}</div>
        {!selectedPrId ? (
          <EmptyState icon="Users" title={t("configure.noPrSelected")} />
        ) : (
          <Card>
            <div style={s.checklistCard}>
              <div style={s.checklistHead}>
                <Checkbox checked={allSelected} onChange={toggleAll} label={t("configure.selectAll")} />
              </div>
              {sortedAgents.map((agent) => {
                const estimate = estimateFor(estimates ?? [], agent.id);
                return (
                  <div key={agent.id} style={s.row}>
                    <Checkbox
                      checked={selectedAgentIds.has(agent.id)}
                      onChange={() =>
                        setSelectedAgentIds((prev) => toggleId(prev, agent.id))
                      }
                    />
                    <Icon.Cpu size={15} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
                    <div style={s.rowMain}>
                      <div style={s.rowName}>{agent.name}</div>
                      {agent.description && <div style={s.rowDescription}>{agent.description}</div>}
                    </div>
                    <div style={s.rowEstimate}>
                      {formatDuration(estimate?.avg_duration_ms ?? null)} ·{" "}
                      {formatCost(estimate?.avg_cost_usd ?? null)}
                    </div>
                  </div>
                );
              })}

              <div style={s.footer}>
                <Button
                  kind="primary"
                  icon="Play"
                  disabled={selectedAgentIds.size === 0 || startRun.isPending}
                  loading={startRun.isPending}
                  onClick={handleRun}
                >
                  {t("configure.runAction", { count: selectedAgentIds.size })}
                </Button>
                <div style={s.aggregateLine}>
                  {t("configure.aggregate", {
                    duration: formatDuration(aggregate.durationMs),
                    cost: formatCost(aggregate.costUsd),
                  })}
                </div>
                <div style={s.aggregateLine}>{t("configure.parallelFanOut")}</div>
              </div>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
