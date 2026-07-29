/* WorkspaceEvalDashboard — /eval (AC-35). One row per enabled agent (name,
   model, last batch, recall trend, current metrics) + a flat newest-first
   cross-agent run history below. "Run all agents" states the total case
   count across every agent before confirming (edge case 16 — N agents ×
   M cases each is real, paid model calls). */
"use client";

import React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button, Badge, Card, Skeleton, EmptyState, ErrorState, Sparkline, Icon } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { MetricStrip, formatMetric } from "@/components/eval";
import { RunCostBadge } from "@/components/RunCostBadge";
import { useWorkspaceEvalDashboard, useRunAllEvals } from "@/lib/hooks";
import { ApiError } from "@/lib/api";
import { useToast } from "@/lib/toast";
import type { EvalAgentRow, EvalRunRecord } from "@/lib/types";
import { sortAgentsByName, totalCaseCount, batchLineParts } from "./helpers";
import { SKELETON_ROWS, RECALL_SPARKLINE_WIDTH, RECALL_SPARKLINE_HEIGHT, MAX_VISIBLE_RUNS } from "./constants";
import { s } from "./styles";

export function WorkspaceEvalDashboard() {
  const t = useTranslations("eval");
  const toast = useToast();
  const { data, isLoading, isError, error, refetch } = useWorkspaceEvalDashboard();
  const runAll = useRunAllEvals();

  const agents = React.useMemo(() => sortAgentsByName(data?.agents ?? []), [data?.agents]);
  const totalCases = totalCaseCount(agents);
  const runs = (data?.workspace.recent_runs ?? []).slice(0, MAX_VISIBLE_RUNS);

  const crumb = [{ label: t("page.crumbSkillsLab") }, { label: t("page.crumbEvalDashboard") }];

  const handleRunAll = () => {
    // Edge case 16 — this is N agents × their case counts in real, paid model
    // calls; the confirm states the total before the user commits.
    if (!window.confirm(t("workspace.runAllConfirm", { count: totalCases }))) return;
    runAll.mutate(undefined, {
      onError: (err) => toast.error(err instanceof ApiError ? err.message : t("workspace.errorBody")),
    });
  };

  if (isError) {
    return (
      <AppShell crumb={crumb}>
        <ErrorState
          fullScreen
          title={t("workspace.errorTitle")}
          body={error instanceof ApiError ? error.message : t("workspace.errorBody")}
          onRetry={() => refetch()}
        />
      </AppShell>
    );
  }

  return (
    <AppShell crumb={crumb}>
      <div style={s.pageHeader}>
        <h1 style={s.pageTitle}>{t("workspace.title")}</h1>
        <div style={s.headerActions}>
          <Button
            kind="primary"
            icon="Play"
            onClick={handleRunAll}
            loading={runAll.isPending}
            disabled={isLoading || agents.length === 0}
          >
            {t("workspace.runAllAgents")}
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div style={s.loadingStack}>
          {Array.from({ length: SKELETON_ROWS }).map((_, i) => (
            <Skeleton key={i} height={120} />
          ))}
        </div>
      ) : agents.length === 0 ? (
        <EmptyState icon="BarChart" title={t("workspace.empty")} />
      ) : (
        <div style={s.rowStack}>
          {agents.map((row) => (
            <AgentRow key={row.agent_id} row={row} />
          ))}
        </div>
      )}

      <h2 style={s.sectionTitle}>{t("dashboard.recentRuns")}</h2>
      <div style={s.tableCard}>
        <div style={s.headRow(s.runsGrid)}>
          <div>{t("dashboard.table.case")}</div>
          <div>{t("dashboard.table.ranAt")}</div>
          <div>{t("dashboard.table.pass")}</div>
          <div>{t("dashboard.table.recall")}</div>
          <div>{t("dashboard.table.precision")}</div>
          <div>{t("dashboard.table.citation")}</div>
          <div>{t("dashboard.table.cost")}</div>
        </div>
        {runs.length === 0 ? (
          <EmptyState icon="History" title={t("dashboard.noRuns")} />
        ) : (
          runs.map((run) => <RunRow key={run.id} run={run} />)
        )}
      </div>
    </AppShell>
  );
}

function AgentRow({ row }: { row: EvalAgentRow }) {
  const t = useTranslations("eval");
  const batch = row.last_batch;
  const na = {
    recall: batch?.recall_na ?? true,
    precision: batch?.precision_na ?? true,
    citation_accuracy: batch?.citation_accuracy_na ?? true,
  };
  return (
    <Link href={`/eval/${row.agent_id}`} style={s.rowLink}>
      <Card hover style={s.rowCard}>
        <div style={s.rowHead}>
          <span style={s.rowName}>{row.agent_name}</span>
          <Badge mono color="var(--text-secondary)">
            {row.provider}/{row.model}
          </Badge>
          <div style={s.rowTrend}>
            <Sparkline
              data={row.recall_trend}
              color="var(--accent)"
              w={RECALL_SPARKLINE_WIDTH}
              h={RECALL_SPARKLINE_HEIGHT}
            />
            <span className="tnum" style={s.rowTrendValue}>
              {formatMetric(batch?.recall ?? 0, na.recall)}
            </span>
          </div>
        </div>
        <div style={s.rowBatchLine}>
          {batch ? t("workspace.batchLabel", batchLineParts(batch)) : t("dashboard.neverRun")}
        </div>
        <MetricStrip
          recall={{ value: batch?.recall ?? 0, na: na.recall }}
          precision={{ value: batch?.precision ?? 0, na: na.precision }}
          citation_accuracy={{ value: batch?.citation_accuracy ?? 0, na: na.citation_accuracy }}
        />
      </Card>
    </Link>
  );
}

function RunRow({ run }: { run: EvalRunRecord }) {
  const t = useTranslations("eval");
  return (
    <div style={s.runRow(s.runsGrid)}>
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {run.case_name ?? run.case_id}
      </span>
      <span className="tnum" style={{ color: "var(--text-muted)" }}>
        {new Date(run.ran_at).toLocaleString()}
      </span>
      <PassFail pass={run.pass} />
      <span className="tnum">{run.recall != null ? formatMetric(run.recall, false) : "—"}</span>
      <span className="tnum">{run.precision != null ? formatMetric(run.precision, false) : "—"}</span>
      <span className="tnum">{run.citation_accuracy != null ? formatMetric(run.citation_accuracy, false) : "—"}</span>
      <RunCostBadge usd={run.cost_usd} />
    </div>
  );
}

/** Pass/fail conveyed by an icon AND text, never colour alone (Accessibility NFR). */
export function PassFail({ pass }: { pass: boolean | null }) {
  const t = useTranslations("eval");
  if (pass == null) return <span style={{ color: "var(--text-muted)" }}>—</span>;
  const I = pass ? Icon.CheckCircle : Icon.XCircle;
  const color = pass ? "var(--ok)" : "var(--crit)";
  return (
    <span style={s.passFail(color)}>
      <I size={13} aria-hidden="true" />
      {pass ? t("dashboard.pass") : t("dashboard.fail")}
    </span>
  );
}
