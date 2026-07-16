/* IntentCard — shown above the PR description on the Overview tab. Reads the
   stored PR intent/scope (never computes it), offers a manual "Recalculate"
   action, and a per-repo override for which model the classifier uses. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, SectionLabel, FormField, SearchableSelect } from "@devdigest/ui";
import {
  usePrIntent,
  useRecalculateIntent,
  useRepoIntentModel,
  useSetRepoIntentModel,
} from "@/lib/hooks";
import { useProviderModels } from "@/lib/hooks/agents";
import { toModelOptions } from "@/lib/model-label";
import { s } from "./styles";

interface IntentCardProps {
  prId: string | null;
  repoId: string;
}

export function IntentCard({ prId, repoId }: IntentCardProps) {
  const t = useTranslations("prReview");
  const { data: intent, isLoading } = usePrIntent(prId);
  const recalculate = useRecalculateIntent(prId);
  const { data: repoModel } = useRepoIntentModel(repoId);
  const setRepoModel = useSetRepoIntentModel(repoId);
  const { data: models } = useProviderModels("openrouter");

  const baseOptions = toModelOptions(models);
  const currentModel = repoModel?.model ?? null;
  const options =
    currentModel && !baseOptions.some((o) => (typeof o === "string" ? o : o.value) === currentModel)
      ? [currentModel, ...baseOptions]
      : baseOptions;

  return (
    <section>
      <SectionLabel
        icon="Target"
        right={
          <Button
            kind="secondary"
            size="sm"
            icon="RefreshCw"
            loading={recalculate.isPending}
            disabled={!prId}
            onClick={() => recalculate.mutate()}
          >
            {recalculate.isPending ? t("intent.recalculating") : t("intent.recalculate")}
          </Button>
        }
      >
        {t("intent.label")}
      </SectionLabel>

      <div style={s.card}>
        {/* Scrollable read-only content only — the model picker below opens a
           dropdown (`SearchableSelect`, absolutely positioned, not a portal)
           that an `overflow` ancestor would clip, so it stays outside this
           scroll region. */}
        <div style={s.scrollArea}>
          {isLoading ? (
            <div style={s.empty}>{t("intent.loading")}</div>
          ) : !intent ? (
            <div style={s.empty}>{t("intent.empty")}</div>
          ) : (
            <>
              <p style={s.summary}>{intent.intent}</p>
              {intent.in_scope.length > 0 && (
                <div style={s.list}>
                  <div style={s.listLabel}>{t("intent.inScope")}</div>
                  <ul style={s.ul}>
                    {intent.in_scope.map((item, i) => (
                      <li key={i}>{item}</li>
                    ))}
                  </ul>
                </div>
              )}
              {intent.out_of_scope.length > 0 && (
                <div style={s.list}>
                  <div style={s.listLabel}>{t("intent.outOfScope")}</div>
                  <ul style={s.ul}>
                    {intent.out_of_scope.map((item, i) => (
                      <li key={i}>{item}</li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}

          {recalculate.isError && <div style={s.error}>{t("intent.recalculateError")}</div>}
        </div>

        <div style={s.modelRow}>
          <FormField
            label={
              <>
                {t("intent.modelLabel")}
                {!currentModel && <span style={s.defaultTag}>{t("intent.usingDefault")}</span>}
              </>
            }
            hint={t("intent.modelHint")}
          >
            <SearchableSelect
              value={currentModel ?? ""}
              onChange={(m) => setRepoModel.mutate({ provider: "openrouter", model: m })}
              options={options}
              placeholder={t("intent.modelSearch")}
            />
          </FormField>
        </div>
      </div>
    </section>
  );
}
