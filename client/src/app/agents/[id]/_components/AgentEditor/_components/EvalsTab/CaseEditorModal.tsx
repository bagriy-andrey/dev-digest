"use client";

/* CaseEditorModal — create/edit an eval case (SPEC-03 §"Case editor modal").
   Name + notes + `expected_output` are the editable fields; `input_diff`/
   `input_files`/`input_meta` are rendered read-only (frozen snapshots per
   AC-24 — this modal authors expectations, not diffs). "Run on save" is
   component-local UI state only, never persisted (plan assumption 4). */

import React from "react";
import { useTranslations } from "next-intl";
import {
  Button,
  FormField,
  Icon,
  Modal,
  Tabs,
  TextInput,
  Textarea,
  Toggle,
} from "@devdigest/ui";
import type { Agent } from "@devdigest/shared";
import type { EvalCase, EvalCaseInput } from "@/lib/types";
import { RunCostBadge } from "@/components/RunCostBadge";
import {
  useCreateEvalCase,
  useEvalRuns,
  useRunEvalCase,
  useUpdateEvalCase,
} from "@/lib/hooks/evals";
import { FINDING_SKELETON, INPUT_TABS, type InputTab } from "./constants";
import {
  asRunDetail,
  latestRunForCase,
  mustFindCount,
  parseExpectations,
  validateExpectedOutputJson,
} from "./helpers";
import { s } from "./styles";

interface InputFileEntry {
  path: string;
  additions?: number;
  deletions?: number;
}

interface PrMetaShape {
  pr_title?: string;
  pr_body?: string;
}

function pct(v: number | null | undefined): string {
  return v == null ? "—" : `${Math.round(v * 100)}`;
}

export function CaseEditorModal({
  agent,
  evalCase,
  onClose,
}: {
  agent: Agent;
  evalCase: EvalCase | null;
  onClose: () => void;
}) {
  const t = useTranslations("eval");

  const [name, setName] = React.useState(evalCase?.name ?? "");
  const [notes, setNotes] = React.useState(evalCase?.notes ?? "");
  const [expectedOutputText, setExpectedOutputText] = React.useState(() =>
    JSON.stringify(evalCase?.expected_output ?? [], null, 2),
  );
  // Component-local only — no contract/column backs this (plan D-assumption 4).
  const [runOnSave, setRunOnSave] = React.useState(false);
  const [activeInputTab, setActiveInputTab] = React.useState<InputTab>("diff");

  const createCase = useCreateEvalCase();
  const updateCase = useUpdateEvalCase();
  const runCase = useRunEvalCase();
  const { data: runs } = useEvalRuns(agent.id);

  const lastRun = evalCase ? latestRunForCase(runs, evalCase.id) : null;
  const validation = validateExpectedOutputJson(expectedOutputText);
  const isSaving = createCase.isPending || updateCase.isPending;
  const canSave = validation.valid && name.trim().length > 0 && !isSaving;

  function handleInsertSkeleton() {
    const current = Array.isArray(validation.parsed) ? validation.parsed : [];
    setExpectedOutputText(JSON.stringify([...current, FINDING_SKELETON], null, 2));
  }

  function handleSave() {
    if (!validation.valid) return;
    const input: EvalCaseInput = {
      owner_kind: "agent",
      owner_id: agent.id,
      name: name.trim(),
      input_diff: evalCase?.input_diff ?? "",
      input_files: evalCase?.input_files ?? null,
      input_meta: evalCase?.input_meta ?? null,
      expected_output: validation.parsed ?? [],
      notes: notes.trim() === "" ? null : notes.trim(),
    };

    const afterSave = (saved: EvalCase) => {
      if (runOnSave) runCase.mutate({ agentId: agent.id, caseId: saved.id });
      onClose();
    };

    if (evalCase) {
      updateCase.mutate(
        { agentId: agent.id, caseId: evalCase.id, input },
        { onSuccess: afterSave },
      );
    } else {
      createCase.mutate({ agentId: agent.id, input }, { onSuccess: afterSave });
    }
  }

  function handleRunCase() {
    if (!evalCase) return;
    runCase.mutate({ agentId: agent.id, caseId: evalCase.id });
  }

  const files: InputFileEntry[] = Array.isArray(evalCase?.input_files)
    ? (evalCase.input_files as InputFileEntry[])
    : [];
  const meta = (evalCase?.input_meta ?? {}) as PrMetaShape;

  return (
    <Modal
      title={evalCase ? t("caseEditor.caseTitle", { name: evalCase.name }) : t("caseEditor.newCase")}
      onClose={onClose}
      width={720}
      footer={
        <div style={s.footer}>
          <Button kind="ghost" onClick={onClose}>
            {t("caseEditor.cancel")}
          </Button>
          {evalCase && (
            <Button kind="secondary" icon="Play" onClick={handleRunCase} loading={runCase.isPending}>
              {runCase.isPending ? t("caseEditor.running") : t("caseEditor.runCase")}
            </Button>
          )}
          <Button kind="primary" onClick={handleSave} disabled={!canSave} loading={isSaving}>
            {isSaving ? t("caseEditor.saving") : t("caseEditor.save")}
          </Button>
        </div>
      }
    >
      <div style={s.modalBody}>
        <FormField label={t("caseEditor.nameLabel")} required>
          <TextInput value={name} onChange={setName} placeholder={t("caseEditor.namePlaceholder")} />
        </FormField>

        <FormField label={t("caseEditor.inputLabel")}>
          <div style={s.inputTabsBar}>
            <Tabs
              tabs={INPUT_TABS.map((k) => ({ key: k, label: t(`caseEditor.tabs.${k}`) }))}
              value={activeInputTab}
              onChange={(k) => setActiveInputTab(k as InputTab)}
              pad="0 14px"
            />
            <div style={s.inputTabBody}>
              {activeInputTab === "diff" && (
                <pre style={s.diffBlock}>{evalCase?.input_diff || t("caseEditor.diffPlaceholder")}</pre>
              )}
              {activeInputTab === "files" &&
                (files.length === 0 ? (
                  <span>{t("caseEditor.noFilesRecorded")}</span>
                ) : (
                  files.map((f) => (
                    <div key={f.path} style={s.fileRow}>
                      <Icon.File size={12} />
                      {f.path}
                    </div>
                  ))
                ))}
              {activeInputTab === "prMeta" && (
                <>
                  <div style={s.metaRow}>
                    <span style={s.metaLabel}>{t("caseEditor.titleLabel")}</span>
                    <span style={s.metaValue}>{meta.pr_title || t("caseEditor.titlePlaceholder")}</span>
                  </div>
                  <div style={s.metaRow}>
                    <span style={s.metaLabel}>{t("caseEditor.bodyLabel")}</span>
                    <span style={s.metaValue}>{meta.pr_body || t("caseEditor.bodyPlaceholder")}</span>
                  </div>
                </>
              )}
            </div>
          </div>
        </FormField>

        {lastRun && (
          <div style={s.lastRunStrip}>
            <div style={s.lastRunHeadline}>
              {lastRun.pass ? (
                <Icon.CheckCircle size={15} style={{ color: "var(--ok)" }} />
              ) : (
                <Icon.XCircle size={15} style={{ color: "var(--crit)" }} />
              )}
              {t(lastRun.pass ? "caseEditor.lastRunPassed" : "caseEditor.lastRunFailed")}
            </div>
            <div style={s.lastRunDetail}>
              {t("evalsTab.expectedGot", {
                expected: mustFindCount(parseExpectations(evalCase?.expected_output)),
                got: asRunDetail(lastRun.actual_output)?.counts.actual ?? "—",
              })}
            </div>
            <div style={s.lastRunDetail}>
              {t("caseEditor.resultSummary", {
                recall: pct(lastRun.recall),
                precision: pct(lastRun.precision),
                citation: pct(lastRun.citation_accuracy),
                duration: lastRun.duration_ms != null ? (lastRun.duration_ms / 1000).toFixed(1) : "—",
              })}
              {" · "}
              {t("dashboard.table.cost")} <RunCostBadge usd={lastRun.cost_usd} />
            </div>
          </div>
        )}

        <FormField
          label={t("caseEditor.expectedOutput")}
          right={
            <span style={s.validityBadge}>
              {validation.valid ? (
                <Icon.Check size={14} style={{ color: "var(--ok)" }} />
              ) : (
                <Icon.X size={14} style={{ color: "var(--crit)" }} />
              )}
              <span style={{ color: validation.valid ? "var(--ok)" : "var(--crit)" }}>
                {validation.valid ? t("caseEditor.validJson") : t("caseEditor.invalidJson")}
              </span>
            </span>
          }
        >
          <Textarea mono rows={10} value={expectedOutputText} onChange={setExpectedOutputText} />
          <div style={{ marginTop: 8 }}>
            <Button kind="secondary" size="sm" icon="Plus" onClick={handleInsertSkeleton}>
              {t("caseEditor.insertSkeleton")}
            </Button>
          </div>
          {!validation.valid && (
            <div style={s.validationError}>
              {t("caseEditor.validationError", { message: validation.error ?? "" })}
            </div>
          )}
        </FormField>

        <FormField label={t("caseEditor.notesLabel")}>
          <Textarea
            rows={3}
            value={notes ?? ""}
            onChange={setNotes}
            placeholder={t("caseEditor.notesPlaceholder")}
          />
        </FormField>

        <div style={s.runOnSaveRow}>
          <Toggle on={runOnSave} onChange={setRunOnSave} />
          <span>{t("caseEditor.runOnSave")}</span>
        </div>
      </div>
    </Modal>
  );
}
