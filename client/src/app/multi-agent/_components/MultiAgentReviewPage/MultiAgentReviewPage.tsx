/* MultiAgentReviewPage — the only stateful container for /multi-agent
   (AC-6, AC-7, AC-30, AC-32…AC-44). Mode is driven by the `?pr=`/`?new=`
   query params: no `pr` and no `new=1` ⇒ the "recent runs" landing list
   (useRecentMultiAgentGroups) — real run history across every PR in the
   workspace, newest first, NOT an auto-redirect onto a single "latest" run
   (that was tried and reverted: it made the page feel stuck on one run and
   gave no way to see anything else). An empty list still falls through to
   Configure-run (nothing to list yet). `new=1` (the "Start new review"
   button, or a first-time empty history) ⇒ Configure-run view, PR picker
   only, step 2 disabled; `pr` set but `useMultiAgentRun` resolves to `null`
   (D7 — no group yet) ⇒ still Configure-run view, now with that PR's agent
   checklist; `pr` set and a group exists ⇒ results view. ONE
   `useMultiAgentRun` fetch feeds Columns and Tabs as render branches over
   the same object — never fetched twice. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Button, EmptyState, ErrorState, Skeleton, Tabs } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { ApiError } from "@/lib/api";
import {
  useMultiAgentRun,
  usePrReviews,
  useRecentMultiAgentGroups,
  useRunEvents,
} from "@/lib/hooks";
import type { AgentColumn } from "@/lib/types";
// D12: import the EXISTING drawer in place — never relocate or copy it. If
// this bracketed-route specifier ever fails to resolve under webpack, the
// fallback is a relative path to the SAME physical file, never a new one:
// "../../../repos/[repoId]/pulls/[number]/_components/RunTraceDrawer".
import RunTraceDrawer from "@/app/repos/[repoId]/pulls/[number]/_components/RunTraceDrawer";
import { ColumnsView } from "./_components/ColumnsView";
import { ConfigureRun } from "./_components/ConfigureRun";
import { DisagreementPanel } from "./_components/DisagreementPanel";
import { RecentRunsList } from "./_components/RecentRunsList";
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
  const isNewFlow = searchParams.get("new") === "1";

  const { data: group, isLoading, isError, error, refetch } = useMultiAgentRun(prId);
  const { data: reviews } = usePrReviews(prId);

  // Landing list: every past run across the workspace, newest first — no
  // PR selected yet and not explicitly starting a new one.
  const wantsRecent = !prId && !isNewFlow;
  const { data: recentGroups, isLoading: isRecentLoading } = useRecentMultiAgentGroups(wantsRecent);

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
    if (wantsRecent && isRecentLoading) {
      return (
        <AppShell crumb={crumb}>
          <div style={s.page}>
            <div style={s.loadingStack}>
              <Skeleton height={80} />
              <Skeleton height={240} />
            </div>
          </div>
        </AppShell>
      );
    }
    if (wantsRecent && recentGroups && recentGroups.length > 0) {
      return (
        <AppShell crumb={crumb}>
          <div style={s.page}>
            <PageTitle
              t={t}
              action={
                <Button kind="secondary" size="sm" icon="Plus" onClick={() => router.push("/multi-agent?new=1")}>
                  {t("results.startNew")}
                </Button>
              }
            />
            <div style={s.resultsStack}>
              <div style={s.sectionLabel}>{t("configure.recentRunsTitle")}</div>
              <RecentRunsList groups={recentGroups} onOpenGroup={handleSelectPr} />
            </div>
          </div>
        </AppShell>
      );
    }
    // No history yet in this workspace (or explicitly starting a new one,
    // `new=1`) — nothing to list, so go straight to Configure-run.
    return (
      <AppShell crumb={crumb}>
        <div style={s.page}>
          <PageTitle t={t} />
          <ConfigureRun selectedPrId={null} onSelectPr={handleSelectPr} />
        </div>
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
        <div style={s.page}>
          <div style={s.loadingStack}>
            <Skeleton height={80} />
            <Skeleton height={240} />
          </div>
        </div>
      </AppShell>
    );
  }

  if (!group) {
    // 200 + null (D7): no group exists yet for this PR. Still Configure-run —
    // the PR is already selected via the URL, so step 2's checklist renders.
    return (
      <AppShell crumb={crumb}>
        <div style={s.page}>
          <PageTitle t={t} />
          <ConfigureRun key={prId} selectedPrId={prId} onSelectPr={handleSelectPr} />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell crumb={crumb}>
      <div style={s.page}>
        <PageTitle
          t={t}
          action={
            <Button kind="secondary" size="sm" icon="Plus" onClick={() => router.push("/multi-agent?new=1")}>
              {t("results.startNew")}
            </Button>
          }
        />
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

function PageTitle({
  t,
  action,
}: {
  t: ReturnType<typeof useTranslations>;
  action?: React.ReactNode;
}) {
  return (
    <div style={s.pageHeader}>
      <h1 style={s.pageTitle}>{t("title")}</h1>
      {action}
    </div>
  );
}
