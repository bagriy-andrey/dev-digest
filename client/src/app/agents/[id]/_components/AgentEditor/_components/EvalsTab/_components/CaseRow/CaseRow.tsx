"use client";

import { useTranslations } from "next-intl";
import { Icon, IconBtn, SeverityBadge, CategoryTag } from "@devdigest/ui";
import type { EvalCase, EvalRunRecord } from "@/lib/types";
import {
  asRunDetail,
  mustFindCount,
  parseExpectations,
  uniqueCategories,
  uniqueSeverities,
} from "../../helpers";
import { s } from "../../styles";

export function CaseRow({
  evalCase,
  lastRun,
  running,
  onRun,
  onEdit,
  onDelete,
}: {
  evalCase: EvalCase;
  lastRun: EvalRunRecord | null;
  running: boolean;
  onRun: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const t = useTranslations("eval");
  const expectations = parseExpectations(evalCase.expected_output);
  const expected = mustFindCount(expectations);
  const severities = uniqueSeverities(expectations);
  const categories = uniqueCategories(expectations);
  const runDetail = lastRun ? asRunDetail(lastRun.actual_output) : null;
  const got = runDetail?.counts.actual;
  const failureReason = lastRun && lastRun.pass === false && runDetail?.error ? runDetail.error : null;

  return (
    <div style={s.row}>
      <div style={s.rowMain}>
        <div style={s.rowTop}>
          <span style={s.rowName}>{evalCase.name}</span>
          {(severities.length > 0 || categories.length > 0) && (
            <span style={s.rowTags}>
              {severities.map((sev) => (
                <SeverityBadge key={sev} severity={sev} compact />
              ))}
              {categories.map((cat) => (
                <CategoryTag key={cat} category={cat} />
              ))}
            </span>
          )}
        </div>

        {!lastRun ? (
          <div style={s.rowStatus}>{t("evalsTab.neverRun")}</div>
        ) : (
          <div style={s.rowStatus}>
            {lastRun.pass ? (
              <Icon.CheckCircle size={14} style={{ color: "var(--ok)" }} />
            ) : (
              <Icon.XCircle size={14} style={{ color: "var(--crit)" }} />
            )}
            <span>{t(lastRun.pass ? "evalsTab.passed" : "evalsTab.failed")}</span>
            <span>{t("evalsTab.expectedGot", { expected, got: got ?? "—" })}</span>
            {lastRun.recall != null && (
              <span>{t("evalsTab.recallSuffix", { recall: Math.round(lastRun.recall * 100) })}</span>
            )}
          </div>
        )}
        {failureReason && (
          <div style={s.rowFailureReason}>{t("evalsTab.failureReason", { reason: failureReason })}</div>
        )}
      </div>

      <div style={s.rowActions}>
        <IconBtn icon="Play" label={t("evalsTab.run")} onClick={onRun} active={running} />
        <IconBtn icon="Edit" label={t("evalsTab.edit")} onClick={onEdit} />
        <IconBtn icon="Trash" label={t("evalsTab.delete")} onClick={onDelete} danger />
      </div>
    </div>
  );
}
