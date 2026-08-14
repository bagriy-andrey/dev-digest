"use client";

/* EvalsTab — Agent Editor's Evals tab (SPEC-03 §"Agents → Evals tab"). Top
   metric strip for this agent (recall/precision/citation), the case list
   (name, expected/got, pass-fail, severity+category tags derived from
   `expected_output`, per-row Run/Edit/Delete), "Run all evals" (states the
   case count before confirming — spec edge case 16, real money), "+ New eval
   case", and an empty state (AC-21) rather than an error when there are zero
   cases. */

import React from "react";
import { useTranslations } from "next-intl";
import { Button, EmptyState } from "@devdigest/ui";
import type { Agent } from "@devdigest/shared";
import { MetricStrip } from "@/components/eval";
import type { EvalCase } from "@/lib/types";
import {
  useAgentEvalDashboard,
  useDeleteEvalCase,
  useEvalCases,
  useEvalRuns,
  useRunAgentEvals,
  useRunEvalCase,
} from "@/lib/hooks/evals";
import { CaseRow } from "./_components/CaseRow";
import { CaseEditorModal } from "./CaseEditorModal";
import { latestRunForCase } from "./helpers";
import { s } from "./styles";

type EditorState = { mode: "create" } | { mode: "edit"; evalCase: EvalCase } | null;

export function EvalsTab({ agent }: { agent: Agent }) {
  const t = useTranslations("eval");

  const { data: dashboard } = useAgentEvalDashboard(agent.id);
  const { data: cases, isLoading: casesLoading } = useEvalCases(agent.id);
  const { data: runs } = useEvalRuns(agent.id);

  const runAgentEvals = useRunAgentEvals();
  const runCase = useRunEvalCase();
  const deleteCase = useDeleteEvalCase();

  const [editor, setEditor] = React.useState<EditorState>(null);
  const [runningCaseId, setRunningCaseId] = React.useState<string | null>(null);

  const caseList = cases ?? [];
  const running = dashboard?.recent_batches?.[0]?.status === "running";

  function handleRunAll() {
    // Edge case 16: eval runs cost real money — state the case count before
    // the user confirms a run-all.
    if (window.confirm(t("evalsTab.runAllConfirm", { count: caseList.length }))) {
      runAgentEvals.mutate(agent.id);
    }
  }

  function handleRunCase(evalCase: EvalCase) {
    setRunningCaseId(evalCase.id);
    runCase.mutate(
      { agentId: agent.id, caseId: evalCase.id },
      { onSettled: () => setRunningCaseId(null) },
    );
  }

  function handleDeleteCase(evalCase: EvalCase) {
    if (window.confirm(t("caseEditor.deleteConfirm"))) {
      deleteCase.mutate({ agentId: agent.id, caseId: evalCase.id });
    }
  }

  return (
    <div style={s.root}>
      <div>
        <div style={s.header}>
          <span style={s.headerTitle}>{t("evalsTab.metricsTitle")}</span>
        </div>
        {dashboard && (
          <MetricStrip
            recall={{ value: dashboard.current.recall, delta: dashboard.delta.recall }}
            precision={{ value: dashboard.current.precision, delta: dashboard.delta.precision }}
            citation_accuracy={{
              value: dashboard.current.citation_accuracy,
              delta: dashboard.delta.citation_accuracy,
            }}
          />
        )}
      </div>

      <div>
        <div style={s.header}>
          <span style={s.headerTitle}>{t("evalsTab.casesHeading")}</span>
          <Button
            kind="secondary"
            size="sm"
            icon="Play"
            onClick={handleRunAll}
            disabled={caseList.length === 0 || running}
            loading={runAgentEvals.isPending}
          >
            {running ? t("evalsTab.running") : t("evalsTab.runAll")}
          </Button>
          <Button kind="primary" size="sm" icon="Plus" onClick={() => setEditor({ mode: "create" })}>
            {t("evalsTab.newCase")}
          </Button>
        </div>

        {casesLoading ? (
          <div style={s.loading}>{t("evalsTab.loadingCases")}</div>
        ) : caseList.length === 0 ? (
          <EmptyState
            icon="FlaskConical"
            title={t("evalsTab.emptyCases")}
            cta={t("evalsTab.newCase")}
            onCta={() => setEditor({ mode: "create" })}
          />
        ) : (
          <div style={s.list}>
            {caseList.map((c) => (
              <CaseRow
                key={c.id}
                evalCase={c}
                lastRun={latestRunForCase(runs, c.id)}
                running={runningCaseId === c.id}
                onRun={() => handleRunCase(c)}
                onEdit={() => setEditor({ mode: "edit", evalCase: c })}
                onDelete={() => handleDeleteCase(c)}
              />
            ))}
          </div>
        )}
      </div>

      {editor && (
        <CaseEditorModal
          agent={agent}
          evalCase={editor.mode === "edit" ? editor.evalCase : null}
          onClose={() => setEditor(null)}
        />
      )}
    </div>
  );
}
