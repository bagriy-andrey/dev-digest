"use client";

/* ConfigureStep — trigger checkboxes + "Post results as" + the static
   secrets table + the merge-blocking callout. Checkboxes drive the
   generated `on:` block ONE-WAY only: nothing here ever parses a
   hand-edited workflow YAML back into checkbox state (resolved
   clarification 8) — the two are deliberately not kept in sync. */
import React from "react";
import { useTranslations } from "next-intl";
import { Checkbox, FormField, Icon } from "@devdigest/ui";
import { POST_AS_OPTIONS, SECRET_ROWS, TRIGGER_OPTIONS, type PostAsOption } from "../constants";
import { s } from "../styles";

const POST_AS_LABEL_KEY: Record<PostAsOption, string> = {
  github_review: "githubReview",
  pr_comment: "prComment",
  none: "none",
};

export function ConfigureStep({
  triggers,
  onToggleTrigger,
  postAs,
  onPostAsChange,
}: {
  triggers: string[];
  onToggleTrigger: (value: string, checked: boolean) => void;
  postAs: PostAsOption;
  onPostAsChange: (v: PostAsOption) => void;
}) {
  const t = useTranslations("ci");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <FormField label={t("exportWizard.triggerLabel")}>
        <div style={s.checkboxList}>
          {TRIGGER_OPTIONS.map((opt) => (
            <Checkbox
              key={opt.value}
              checked={triggers.includes(opt.value)}
              onChange={(checked) => onToggleTrigger(opt.value, checked)}
              label={t(`exportWizard.triggers.${opt.value}`)}
            />
          ))}
        </div>
      </FormField>

      <FormField label={t("exportWizard.postResultsLabel")}>
        <div style={s.radioList}>
          {POST_AS_OPTIONS.map((opt) => (
            <label
              key={opt}
              style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, cursor: "pointer" }}
            >
              <input
                type="radio"
                name="ci-post-as"
                checked={postAs === opt}
                onChange={() => onPostAsChange(opt)}
              />
              {t(`exportWizard.postAs.${POST_AS_LABEL_KEY[opt]}`)}
              {opt === "github_review" && (
                <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                  ({t("exportWizard.recommended")})
                </span>
              )}
            </label>
          ))}
        </div>
      </FormField>

      <FormField label={t("exportWizard.secretsTable.title")}>
        <table style={s.table}>
          <thead>
            <tr>
              <th style={s.tableHeadCell}>{t("exportWizard.secretsTable.keyHeader")}</th>
              <th style={s.tableHeadCell}>{t("exportWizard.secretsTable.noteHeader")}</th>
            </tr>
          </thead>
          <tbody>
            {SECRET_ROWS.map((row) => (
              <tr key={row.key}>
                <td style={s.tableCell} className="mono">
                  {row.key}
                </td>
                <td style={s.tableCell}>{t(row.noteKey)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </FormField>

      <div style={s.calloutBox}>
        <div style={s.calloutTitle}>
          <Icon.Lock size={15} />
          {t("exportWizard.blockMergeTitle")}
        </div>
        <div style={s.calloutBody}>{t("exportWizard.blockMergeDesc")}</div>
        <div style={s.calloutBody}>{t("exportWizard.blockMergeBody")}</div>
      </div>
    </div>
  );
}
