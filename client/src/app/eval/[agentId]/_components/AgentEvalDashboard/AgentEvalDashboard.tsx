/* AgentEvalDashboard — /eval/:agentId (AC-33/AC-34). Breadcrumb, the one-line
   "largest movement" summary, a metric strip with mini-trends, a multi-series
   trend chart (numeric values always rendered alongside — Accessibility
   NFR), and the batch history table with max-2 Compare selection (AC-27). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Badge, Skeleton, EmptyState, ErrorState, Icon, Checkbox, LineChart } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { MetricStrip, formatMetric, largestMovement, MOVEMENT_I18N_SEGMENT } from "@/components/eval";
import { RunCostBadge } from "@/components/RunCostBadge";
import { useAgent, useAgentEvalDashboard, useRunAgentEvals } from "@/lib/hooks";
import { ApiError } from "@/lib/api";
import { useToast } from "@/lib/toast";
import type { EvalBatchSummary } from "@/lib/types";
import { CompareModal } from "./CompareModal";
import { toggleBatchSelection, metricValuesOf, naFlagsOf } from "./helpers";
import { MAX_COMPARE_SELECTION, TREND_CHART_WIDTH, TREND_CHART_HEIGHT } from "./constants";
import { s } from "./styles";

export function AgentEvalDashboard({ agentId }: { agentId: string }) {
  const t = useTranslations("eval");
  const toast = useToast();
  const { data: agent } = useAgent(agentId);
  const { data: dashboard, isLoading, isError, error, refetch } = useAgentEvalDashboard(agentId);
  const runEval = useRunAgentEvals();

  const [selected, setSelected] = React.useState<string[]>([]);
  const [compareOpen, setCompareOpen] = React.useState(false);

  const recentBatches = dashboard?.recent_batches ?? [];
  const latestBatch = recentBatches[0];
  const previousBatch = recentBatches[1];
  const na = naFlagsOf(latestBatch);

  const movement = dashboard
    ? largestMovement(
        metricValuesOf(dashboard.current),
        previousBatch ? metricValuesOf(previousBatch) : null,
      )
    : null;

  const trendFor = (key: "recall" | "precision" | "citation_accuracy") =>
    (dashboard?.trend ?? []).map((p) => p[key]);

  const crumb = agent
    ? [{ label: t("page.crumbEvalDashboard"), href: "/eval" }, { label: agent.name }]
    : [{ label: t("page.crumbEvalDashboard"), href: "/eval" }];

  const running = latestBatch?.status === "running";

  const handleToggle = (batchId: string, checked: boolean) => {
    setSelected((prev) => toggleBatchSelection(prev, batchId, checked));
  };

  const handleRunEval = () => {
    runEval.mutate(agentId, {
      onError: (err) => toast.error(err instanceof ApiError ? err.message : t("dashboard.errorBody")),
    });
  };

  if (isError) {
    return (
      <AppShell crumb={crumb}>
        <ErrorState
          fullScreen
          title={t("dashboard.errorTitle")}
          body={error instanceof ApiError ? error.message : t("dashboard.errorBody")}
          onRetry={() => refetch()}
        />
      </AppShell>
    );
  }

  const compareDisabled = selected.length < MAX_COMPARE_SELECTION;

  return (
    <AppShell crumb={crumb}>
      <div style={s.pageHeader}>
        <Icon.Cpu size={18} style={{ color: "var(--accent)" }} />
        <h1 style={s.pageTitle}>{agent?.name ?? t("dashboard.defaultTitle")}</h1>
        {agent && (
          <Badge mono color="var(--text-secondary)">
            {agent.provider}/{agent.model}
          </Badge>
        )}
        <div style={s.headerActions}>
          <Button
            kind="secondary"
            icon="Play"
            loading={runEval.isPending}
            disabled={running || (dashboard?.cases_total ?? 0) === 0}
            onClick={handleRunEval}
          >
            {running ? t("dashboard.running") : t("dashboard.runEval", { count: dashboard?.cases_total ?? 0 })}
          </Button>
        </div>
      </div>

      {isLoading || !dashboard ? (
        <div style={s.loadingStack}>
          <Skeleton height={24} width={320} />
          <Skeleton height={120} />
          <Skeleton height={200} />
        </div>
      ) : (
        <>
          <div style={s.passTotal}>
            {dashboard.current.traces_passed}/{dashboard.current.traces_total} {t("dashboard.pass")}
          </div>

          {movement && (
            <div style={s.movementLine}>
              {movement.direction === "up" ? (
                <Icon.TrendingUp size={16} style={{ color: "var(--ok)" }} aria-hidden="true" />
              ) : (
                <Icon.TrendingDown size={16} style={{ color: "var(--crit)" }} aria-hidden="true" />
              )}
              {t(`dashboard.movement.${MOVEMENT_I18N_SEGMENT[movement.metric]}.${movement.direction}`, {
                delta: Math.round(Math.abs(movement.delta) * 100),
              })}
            </div>
          )}

          <div style={s.section}>
            <MetricStrip
              recall={{
                value: dashboard.current.recall,
                na: na.recall,
                delta: dashboard.delta.recall,
                trend: trendFor("recall"),
              }}
              precision={{
                value: dashboard.current.precision,
                na: na.precision,
                delta: dashboard.delta.precision,
                trend: trendFor("precision"),
              }}
              citation_accuracy={{
                value: dashboard.current.citation_accuracy,
                na: na.citation_accuracy,
                delta: dashboard.delta.citation_accuracy,
                trend: trendFor("citation_accuracy"),
              }}
            />
          </div>

          <div style={s.section}>
            <div style={s.sectionTitle}>{t("dashboard.metricTrend")}</div>
            {dashboard.trend.length === 0 ? (
              <EmptyState icon="BarChart" title={t("dashboard.noRuns")} />
            ) : (
              <>
                <LineChart
                  w={TREND_CHART_WIDTH}
                  h={TREND_CHART_HEIGHT}
                  series={[
                    { name: t("dashboard.legend.recall"), color: "var(--accent)", data: trendFor("recall") },
                    { name: t("dashboard.legend.precision"), color: "var(--ok)", data: trendFor("precision") },
                    {
                      name: t("dashboard.legend.citation"),
                      color: "var(--warn)",
                      data: trendFor("citation_accuracy"),
                    },
                  ]}
                />
                {/* Accessibility NFR — the chart is never the only presentation of a
                    metric; the current numeric value is always rendered as text
                    alongside it. */}
                <div style={s.chartLegend}>
                  <span style={s.legendItem}>
                    <span style={s.legendSwatch("var(--accent)")} />
                    {t("dashboard.legend.recall")}: {formatMetric(dashboard.current.recall, na.recall)}
                  </span>
                  <span style={s.legendItem}>
                    <span style={s.legendSwatch("var(--ok)")} />
                    {t("dashboard.legend.precision")}: {formatMetric(dashboard.current.precision, na.precision)}
                  </span>
                  <span style={s.legendItem}>
                    <span style={s.legendSwatch("var(--warn)")} />
                    {t("dashboard.legend.citation")}:{" "}
                    {formatMetric(dashboard.current.citation_accuracy, na.citation_accuracy)}
                  </span>
                </div>
              </>
            )}
          </div>

          <div style={s.section}>
            <div style={s.sectionTitle}>{t("dashboard.batchHistory")}</div>
            <div style={s.tableCard}>
              <div style={s.headRow}>
                <div />
                <div>{t("dashboard.table.version")}</div>
                <div>{t("dashboard.table.ranAt")}</div>
                <div>{t("dashboard.table.pass")}</div>
                <div>{t("dashboard.table.recall")}</div>
                <div>{t("dashboard.table.precision")}</div>
                <div>{t("dashboard.table.citation")}</div>
                <div>{t("dashboard.table.cost")}</div>
                <div>{t("dashboard.table.status")}</div>
              </div>
              {recentBatches.length === 0 ? (
                <EmptyState icon="History" title={t("dashboard.noRuns")} />
              ) : (
                recentBatches.map((batch) => (
                  <BatchRow
                    key={batch.batch_id}
                    batch={batch}
                    checked={selected.includes(batch.batch_id)}
                    disabledForCap={
                      !selected.includes(batch.batch_id) && selected.length >= MAX_COMPARE_SELECTION
                    }
                    onToggle={(checked) => handleToggle(batch.batch_id, checked)}
                  />
                ))
              )}
              <div style={s.compareBar}>
                <Button
                  kind="primary"
                  disabled={compareDisabled}
                  title={compareDisabled ? t("compare.selectTwo") : undefined}
                  aria-describedby={compareDisabled ? "compare-disabled-reason" : undefined}
                  onClick={() => setCompareOpen(true)}
                >
                  {t("compare.compareAction")}
                </Button>
                {compareDisabled && (
                  <span id="compare-disabled-reason" style={s.disabledReason}>
                    {t("compare.selectTwo")}
                  </span>
                )}
              </div>
            </div>
          </div>
        </>
      )}

      {compareOpen && selected.length === MAX_COMPARE_SELECTION && (
        <CompareModal
          agentId={agentId}
          batchA={selected[0]!}
          batchB={selected[1]!}
          onClose={() => setCompareOpen(false)}
        />
      )}
    </AppShell>
  );
}

function BatchRow({
  batch,
  checked,
  disabledForCap,
  onToggle,
}: {
  batch: EvalBatchSummary;
  checked: boolean;
  disabledForCap: boolean;
  onToggle: (checked: boolean) => void;
}) {
  const t = useTranslations("eval");
  return (
    <div style={s.batchRow}>
      <span
        style={s.checkboxWrap(disabledForCap)}
        title={disabledForCap ? t("compare.maxTwoSelected") : undefined}
      >
        <Checkbox checked={checked} onChange={onToggle} />
      </span>
      <span className="tnum">{batch.agent_version != null ? `v${batch.agent_version}` : "—"}</span>
      <span className="tnum" style={{ color: "var(--text-muted)" }}>
        {new Date(batch.ran_at).toLocaleString()}
      </span>
      <span className="tnum">
        {batch.cases_passed}/{batch.cases_total}
      </span>
      <span className="tnum">{formatMetric(batch.recall, batch.recall_na)}</span>
      <span className="tnum">{formatMetric(batch.precision, batch.precision_na)}</span>
      <span className="tnum">{formatMetric(batch.citation_accuracy, batch.citation_accuracy_na)}</span>
      <RunCostBadge usd={batch.cost_usd} />
      <span>{batch.status === "running" ? t("batch.running") : t("batch.complete")}</span>
    </div>
  );
}
