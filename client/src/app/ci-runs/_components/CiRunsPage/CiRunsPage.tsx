"use client";

/* CiRunsPage — /ci-runs (SPEC-04 §"CI Runs page", AC-40..AC-44). One row per
   ingested CI run (PR, repo, agent, status, findings, cost, duration, a link
   to the GitHub Actions job); a genuinely unknown cost/duration renders the
   explicit `runs.unknown` marker, never "0" or a fabricated value (AC-41);
   zero runs renders the how-runs-arrive empty state, not an error (AC-42);
   Refresh runs the ingest pass and shows an in-progress state while pending
   (AC-43). */

import React from "react";
import { useTranslations } from "next-intl";
import { Button, EmptyState, Icon, Skeleton } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { useCiRuns, useRefreshCiRuns } from "@/lib/hooks";
import type { CiRunRow } from "@/lib/hooks/ci";
import { formatRunCost, formatRunDuration, runStatusMeta } from "./helpers";
import { RUNS_GRID } from "./constants";
import { s } from "./styles";

const SKELETON_ROWS = 4;

export function CiRunsPage() {
  const t = useTranslations("ci");
  const { data: runs, isLoading } = useCiRuns();
  const refresh = useRefreshCiRuns();

  // Fine to also fire once on mount (spec) so the table is fresh without
  // requiring an extra click on every visit; the manual button below is the
  // primary, always-available trigger.
  React.useEffect(() => {
    refresh.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const crumb = [{ label: t("page.crumb") }];
  const rows = runs ?? [];

  return (
    <AppShell crumb={crumb}>
      <div style={s.pageHeader}>
        <div style={s.headerText}>
          <h1 style={s.pageTitle}>{t("runs.title")}</h1>
          <p style={s.pageSubtitle}>{t("runs.subtitle")}</p>
        </div>
        <Button
          kind="secondary"
          icon="RefreshCw"
          onClick={() => refresh.mutate()}
          loading={refresh.isPending}
        >
          {refresh.isPending ? t("runs.refreshing") : t("runs.refresh")}
        </Button>
      </div>

      {isLoading ? (
        <div style={s.loadingStack}>
          {Array.from({ length: SKELETON_ROWS }).map((_, i) => (
            <Skeleton key={i} height={40} />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div style={{ margin: "0 32px 20px" }}>
          <EmptyState icon="GitBranch" title={t("runs.emptyTitle")} body={t("runs.emptyHow")} />
        </div>
      ) : (
        <div style={s.tableCard}>
          <div style={s.headRow(RUNS_GRID)}>
            <div>{t("runs.table.timestamp")}</div>
            <div>{t("runs.table.pullRequest")}</div>
            <div>{t("runs.repo")}</div>
            <div>{t("runs.agent")}</div>
            <div>{t("runs.table.status")}</div>
            <div>{t("runs.table.findings")}</div>
            <div>{t("runs.table.cost")}</div>
            <div>{t("runs.duration")}</div>
            <div />
          </div>
          {rows.map((run) => (
            <RunRow key={run.id} run={run} />
          ))}
        </div>
      )}
    </AppShell>
  );
}

function RunRow({ run }: { run: CiRunRow }) {
  const t = useTranslations("ci");
  const meta = runStatusMeta(run.status);
  const StatusIcon = Icon[meta.icon];
  const unknown = t("runs.unknown");

  return (
    <div style={s.runRow(RUNS_GRID)}>
      <span className="tnum" style={{ color: "var(--text-muted)" }}>
        {run.ran_at ? new Date(run.ran_at).toLocaleString() : unknown}
      </span>
      <span className="tnum">{run.pr_number != null ? `#${run.pr_number}` : unknown}</span>
      <span style={s.ellipsis}>{run.repo ?? unknown}</span>
      <span style={s.ellipsis}>{run.agent ?? unknown}</span>
      <span style={s.statusCell}>
        <StatusIcon size={14} style={{ color: meta.color }} aria-hidden="true" />
        {t(meta.labelKey)}
      </span>
      <span className="tnum">{run.findings_count ?? unknown}</span>
      <span className="tnum">{formatRunCost(run.cost_usd, unknown)}</span>
      <span className="tnum">{formatRunDuration(run.duration_s, unknown)}</span>
      {run.github_url ? (
        <a href={run.github_url} target="_blank" rel="noreferrer" style={s.viewJobLink}>
          <Icon.ExternalLink size={12} aria-hidden="true" />
          {t("runs.viewJob")}
        </a>
      ) : (
        <span style={{ color: "var(--text-muted)" }}>{unknown}</span>
      )}
    </div>
  );
}
