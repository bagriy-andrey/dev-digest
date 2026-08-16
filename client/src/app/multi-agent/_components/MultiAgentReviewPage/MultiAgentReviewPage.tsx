/* MultiAgentReviewPage — the only stateful container for /multi-agent
   (AC-6, AC-7, AC-30, AC-32…AC-44). Mode is driven by the `?pr=` query param:
   no `pr` ⇒ Configure-run view (PR picker only, step 2 disabled); `pr` set
   but `useMultiAgentRun` resolves to `null` (D7 — no group yet) ⇒ still
   Configure-run view, now with that PR's agent checklist; `pr` set and a
   group exists ⇒ results view. ONE `useMultiAgentRun` fetch feeds Columns
   and Tabs as render branches over the same object — never fetched twice. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { EmptyState, ErrorState, Skeleton, Tabs } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { ApiError } from "@/lib/api";
import { useMultiAgentRun, usePrReviews, useRunEvents } from "@/lib/hooks";
import type { AgentColumn } from "@/lib/types";
// D12: import the EXISTING drawer in place — never relocate or copy it. If
// this bracketed-route specifier ever fails to resolve under webpack, the
// fallback is a relative path to the SAME physical file, never a new one:
// "../../../repos/[repoId]/pulls/[number]/_components/RunTraceDrawer".
import RunTraceDrawer from "@/app/repos/[repoId]/pulls/[number]/_components/RunTraceDrawer";
import { ColumnsView } from "./_components/ColumnsView";
import { ConfigureRun } from "./_components/ConfigureRun";
import { DisagreementPanel } from "./_components/DisagreementPanel";
import { ResultsHeader } from "./_components/ResultsHeader";
import { TabsView } from "./_components/TabsView";
import { DEFAULT_VIEW_MODE, type ViewMode } from "./constants";
import { findingsForRun } from "./helpers";
import { s } from "./styles";

export function MultiAgentReviewPage() {
  const t = useTranslations("multiAgent");
  const router = useRouter();
  const searchParams = useSearchParams();
  const qc = useQueryClient();
  const prId = searchParams.get("pr");

  const { data: group, isLoading, isError, error, refetch } = useMultiAgentRun(prId);
  const { data: reviews } = usePrReviews(prId);

  const [viewMode, setViewMode] = React.useState<ViewMode>(DEFAULT_VIEW_MODE);
  const [trace, setTrace] = React.useState<{ runId: string; agentName: string } | null>(null);

  // Live status (AC-42): subscribe to SSE for every still-running column;
  // when the stream falls back to idle, refetch the group so it converges
  // without waiting for the next poll tick. Polling (AC-43) is the
  // belt-and-braces path and needs no extra code — it already lives inside
  // useMultiAgentRun's refetchInterval.
  const runningRunIds = React.useMemo(
    () => (group?.columns ?? []).filter((c) => c.status === "running").map((c) => c.run_id),
    [group?.columns]
  );
  const { running } = useRunEvents(runningRunIds);
  const wasRunningRef = React.useRef(running);
  React.useEffect(() => {
    if (wasRunningRef.current && !running && prId) {
      qc.invalidateQueries({ queryKey: ["multi-agent", prId] });
    }
    wasRunningRef.current = running;
  }, [running, prId, qc]);

  const handleSelectPr = (nextPrId: string) => {
    router.push(`/multi-agent?pr=${nextPrId}`);
  };

  const handleOpenTrace = (column: AgentColumn) => {
    setTrace({ runId: column.run_id, agentName: column.agent_name });
  };

  const crumb = [{ label: t("title") }];
  const traceColumn = group?.columns.find((c) => c.run_id === trace?.runId);

  if (!prId) {
    return (
      <AppShell crumb={crumb}>
        <PageTitle t={t} />
        <ConfigureRun selectedPrId={null} onSelectPr={handleSelectPr} />
      </AppShell>
    );
  }

  if (isError) {
    return (
      <AppShell crumb={crumb}>
        <ErrorState
          fullScreen
          title={t("error.title")}
          body={error instanceof ApiError ? error.message : t("error.body")}
          onRetry={() => refetch()}
        />
      </AppShell>
    );
  }

  if (isLoading) {
    return (
      <AppShell crumb={crumb}>
        <div style={s.loadingStack}>
          <Skeleton height={80} />
          <Skeleton height={240} />
        </div>
      </AppShell>
    );
  }

  if (!group) {
    // 200 + null (D7): no group exists yet for this PR. Still Configure-run —
    // the PR is already selected via the URL, so step 2's checklist renders.
    return (
      <AppShell crumb={crumb}>
        <PageTitle t={t} />
        <ConfigureRun key={prId} selectedPrId={prId} onSelectPr={handleSelectPr} />
      </AppShell>
    );
  }

  return (
    <AppShell crumb={crumb}>
      <PageTitle t={t} />
      <div style={s.resultsStack}>
        <ResultsHeader group={group} />

        <div style={s.viewToggleRow}>
          <Tabs
            tabs={[
              { key: "columns", label: t("results.columns") },
              { key: "tabs", label: t("results.tabs") },
            ]}
            value={viewMode}
            onChange={(key) => setViewMode(key as ViewMode)}
            pad="0"
          />
        </div>

        {group.columns.length === 0 ? (
          <EmptyState icon="Users" title={t("empty.title")} body={t("empty.body")} />
        ) : viewMode === "columns" ? (
          <ColumnsView columns={group.columns} onOpenTrace={handleOpenTrace} />
        ) : (
          <TabsView columns={group.columns} reviews={reviews} prId={prId} onOpenTrace={handleOpenTrace} />
        )}

        <DisagreementPanel conflicts={group.conflicts} />
      </div>

      {trace && (
        <RunTraceDrawer
          runId={trace.runId}
          agentName={trace.agentName}
          prNumber={group.pr_number}
          findings={findingsForRun(reviews, trace.runId)}
          running={traceColumn?.status === "running"}
          onClose={() => setTrace(null)}
        />
      )}
    </AppShell>
  );
}

function PageTitle({ t }: { t: ReturnType<typeof useTranslations> }) {
  return (
    <div style={s.pageHeader}>
      <h1 style={s.pageTitle}>{t("title")}</h1>
    </div>
  );
}
