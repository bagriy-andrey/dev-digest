"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { FormField, SearchableSelect, SelectInput } from "@devdigest/ui";
import { useRepos } from "@/lib/hooks";
import { useRepoIntentModel, useSetRepoIntentModel } from "@/lib/hooks";
import { useProviderModels } from "@/lib/hooks/agents";
import { toModelOptions } from "@/lib/model-label";
import { SectionTitle } from "../SectionTitle";
import { s } from "./styles";

/**
 * Settings → Models → per-repository override for the Intent classifier
 * model. The global default lives above in `SettingsModels`; picking a repo
 * here and choosing a model persists a `repo_feature_models` row for
 * `review_intent` that takes precedence over that default for this repo only.
 */
export function SettingsRepoModels() {
  const t = useTranslations("settings");
  const { data: repos } = useRepos();
  const [selectedRepoId, setSelectedRepoId] = React.useState<string>("");

  const { data: repoModel } = useRepoIntentModel(selectedRepoId || null);
  const setRepoModel = useSetRepoIntentModel(selectedRepoId || null);
  const { data: models } = useProviderModels("openrouter");

  const repoOptions = React.useMemo(
    () => [
      { value: "", label: t("repoModels.noRepo") },
      ...(repos ?? []).map((r) => ({ value: r.id, label: r.full_name })),
    ],
    [repos, t],
  );

  const baseOptions = toModelOptions(models);
  const currentModel = repoModel?.model ?? null;
  const options =
    currentModel && !baseOptions.some((o) => (typeof o === "string" ? o : o.value) === currentModel)
      ? [currentModel, ...baseOptions]
      : baseOptions;

  return (
    <div style={s.wrap}>
      <SectionTitle title={t("repoModels.title")} body={t("repoModels.body")} />

      <div style={s.row}>
        <FormField label={t("repoModels.repoLabel")}>
          <SelectInput value={selectedRepoId} onChange={setSelectedRepoId} options={repoOptions} mono={false} />
        </FormField>
      </div>

      {selectedRepoId && (
        <div style={s.row}>
          <FormField
            label={
              <>
                {t("repoModels.modelLabel")}
                {!currentModel && <span style={s.defaultTag}>{t("repoModels.usingDefault")}</span>}
              </>
            }
            hint={t("repoModels.modelHint")}
          >
            <SearchableSelect
              value={currentModel ?? ""}
              onChange={(m) => setRepoModel.mutate({ provider: "openrouter", model: m })}
              options={options}
              placeholder={t("repoModels.search")}
            />
          </FormField>
        </div>
      )}
    </div>
  );
}
