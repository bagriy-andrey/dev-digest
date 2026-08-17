"use client";

/* TargetStep — target picker (GHA recommended; the rest disabled/"not
   available yet") + the destination repo, picked from repos already
   connected to this workspace (a `SearchableSelect` fed by `useRepos()`,
   the same combobox `ConfigTab` uses for its model picker) rather than
   free-typed. */
import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Checkbox, FormField, Icon, SearchableSelect } from "@devdigest/ui";
import { useRepos } from "@/lib/hooks";
import type { CiInstallation, CiTarget } from "@/lib/types";
import { SUPPORTED_TARGET, TARGET_OPTIONS } from "../constants";
import { isValidRepo } from "../helpers";
import { s } from "../styles";

export interface ConflictInstallation extends CiInstallation {
  agent_name?: string | null;
}

export function TargetStep({
  target,
  onTargetChange,
  repo,
  onRepoChange,
  conflict,
  confirmReplace,
  onConfirmReplaceChange,
}: {
  target: CiTarget;
  onTargetChange: (t: CiTarget) => void;
  repo: string;
  onRepoChange: (r: string) => void;
  conflict: ConflictInstallation | null;
  confirmReplace: boolean;
  onConfirmReplaceChange: (v: boolean) => void;
}) {
  const t = useTranslations("ci");
  const repoTouched = repo.trim().length > 0;
  const repoValid = isValidRepo(repo);
  const { data: repos, isSuccess: reposLoaded } = useRepos();
  const repoOptions = [...(repos ?? [])]
    .map((r) => r.full_name)
    .sort((a, b) => a.localeCompare(b));
  const noRepos = reposLoaded && repoOptions.length === 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div>
        <div style={s.targetGrid}>
          {TARGET_OPTIONS.map((opt) => {
            const active = target === opt.value;
            const unavailable = opt.value !== SUPPORTED_TARGET;
            const I = Icon[opt.icon];
            return (
              <button
                key={opt.value}
                type="button"
                style={s.targetCard(active, unavailable)}
                onClick={() => onTargetChange(opt.value)}
                aria-pressed={active}
              >
                <div style={s.targetCardTop}>
                  <I size={16} />
                  <span style={s.targetCardTitle}>{t(`exportWizard.targets.${opt.value}`)}</span>
                  {opt.recommended && (
                    <Badge color="var(--ok)" bg="var(--ok-bg, var(--bg-hover))">
                      {t("exportWizard.recommended")}
                    </Badge>
                  )}
                </div>
                <div style={s.targetCardDesc}>{t(`exportWizard.targets.${opt.value}Desc`)}</div>
                {active && unavailable && (
                  <div style={s.notAvailable}>{t("exportWizard.notAvailableYet")}</div>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <FormField
        label={t("exportWizard.repoLabel")}
        hint={noRepos ? t("exportWizard.repoEmptyHint") : t("exportWizard.repoHint")}
        required
      >
        <SearchableSelect
          value={repo}
          onChange={onRepoChange}
          options={repoOptions}
          placeholder={t("exportWizard.repoSearch")}
        />
        {repoTouched && !repoValid && (
          <div style={{ fontSize: 12, color: "var(--crit)", marginTop: 6 }}>
            {t("exportWizard.repoInvalid")}
          </div>
        )}
      </FormField>

      {conflict && (
        <div style={s.warningBox} role="alert">
          <div style={s.warningHead}>
            <Icon.AlertTriangle size={16} style={{ color: "var(--warn, var(--text-secondary))", flexShrink: 0 }} />
            <span>
              {t("exportWizard.replaceWarning", {
                repo: conflict.repo,
                agentName: conflict.agent_name ?? t("exportWizard.thisAgent"),
              })}
            </span>
          </div>
          <Checkbox
            checked={confirmReplace}
            onChange={onConfirmReplaceChange}
            label={t("exportWizard.replaceConfirm")}
          />
        </div>
      )}
    </div>
  );
}
