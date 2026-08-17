"use client";

/* CiTab — Agent Editor's CI tab (SPEC-04 §"Agent CI tab", AC-36..AC-39). A
   "CI deployment" header + installed-in-N-repos pill + Update/Add-to-CI
   actions (both open the Step 4 `ExportWizard` — it owns target/replace/
   preview/install itself, this tab only decides *when* to show it); one row
   per installation (repo, target badge, latest run status via text+icon,
   never colour alone, relative time) or an empty-state CTA when there are
   none (never an error); and the Fail-CI-on gate bound straight to
   `agent.ci_fail_on` through the existing `useUpdateAgent` mutation — no new
   server code, the field is already wired end-to-end. The stale-manifest
   notice (AC-39) makes clear that changing the gate here does NOT touch any
   already-installed repo until the wizard is re-run for it. */

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, EmptyState, FormField, Icon, SelectInput } from "@devdigest/ui";
import type { Agent, CiFailOn } from "@devdigest/shared";
import { ExportWizard } from "@/components/ci/ExportWizard";
import { useCiInstallations, useUpdateAgent } from "@/lib/hooks";
import type { CiInstallationRow } from "@/lib/hooks/ci";
import { CI_FAIL_ON_VALUES } from "./constants";
import { relativeTime, runStatusMeta } from "./helpers";
import { s } from "./styles";

export function CiTab({ agent }: { agent: Agent }) {
  const t = useTranslations("ci");
  const { data: installations, isLoading } = useCiInstallations(agent.id);
  const updateAgent = useUpdateAgent();
  const [wizardOpen, setWizardOpen] = React.useState(false);

  const rows = installations ?? [];

  function handleFailCiOnChange(value: string) {
    updateAgent.mutate({ id: agent.id, patch: { ci_fail_on: value as CiFailOn } });
  }

  return (
    <div style={s.root}>
      <div style={s.header}>
        <div style={s.headerText}>
          <h2 style={s.heading}>{t("ciTab.heading")}</h2>
          <p style={s.subtitle}>{t("ciTab.subtitle")}</p>
        </div>
        <Badge icon="GitBranch">{t("ciTab.installedIn", { count: rows.length })}</Badge>
        <div style={s.actions}>
          <Button kind="secondary" size="sm" onClick={() => setWizardOpen(true)}>
            {t("ciTab.updateConfig")}
          </Button>
          <Button kind="primary" size="sm" icon="Plus" onClick={() => setWizardOpen(true)}>
            {t("ciTab.addToCi")}
          </Button>
        </div>
      </div>

      {!isLoading && rows.length === 0 ? (
        <EmptyState
          icon="GitBranch"
          title={t("ciTab.emptyBody")}
          cta={t("ciTab.addToCi")}
          onCta={() => setWizardOpen(true)}
        />
      ) : (
        <div style={s.list}>
          {rows.map((row) => (
            <InstallationRow key={row.id} row={row} />
          ))}
        </div>
      )}

      <div style={s.failCiOnSection}>
        <FormField label={t("ciTab.failCiOn")}>
          <SelectInput
            value={agent.ci_fail_on}
            onChange={handleFailCiOnChange}
            options={CI_FAIL_ON_VALUES.map((v) => ({ value: v, label: t(`ciTab.failCiOnOptions.${v}`) }))}
          />
        </FormField>
        <p style={s.staleNotice}>{t("ciTab.staleNotice")}</p>
      </div>

      {wizardOpen && (
        <ExportWizard agentId={agent.id} agentName={agent.name} onClose={() => setWizardOpen(false)} />
      )}
    </div>
  );
}

function InstallationRow({ row }: { row: CiInstallationRow }) {
  const t = useTranslations("ci");
  const meta = runStatusMeta(row.latest_run?.status ?? null);
  const StatusIcon = Icon[meta.icon];
  const time = relativeTime(row.latest_run?.ran_at ?? null);

  return (
    <div style={s.row}>
      <div style={s.rowMain}>
        <span style={s.rowRepo}>{row.repo}</span>
        <Badge mono>{row.target_type}</Badge>
      </div>
      <div style={s.rowStatus}>
        <StatusIcon size={14} style={{ color: meta.color }} />
        <span>{t(meta.labelKey)}</span>
        <span style={s.rowTime}>{time ?? t("ciTab.never")}</span>
      </div>
    </div>
  );
}
