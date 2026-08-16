"use client";

/* InstallStep — "Open a PR with these files" (recommended) + "Copy files as
   a zip" (built entirely client-side from the already-fetched `CiFile[]`,
   including the runner bundle — no new server endpoint, AC-33) + a docs
   link. On success, surfaces the PR URL as the next action (AC-34). */
import React from "react";
import { useTranslations } from "next-intl";
import { Button, Icon, MonoLink } from "@devdigest/ui";
import type { CiFile } from "@/lib/types";
import { notify } from "@/lib/toast";
import { DOCS_URL } from "../constants";
import { filesToZip, mergeEdits } from "../helpers";
import { s } from "../styles";

export function InstallStep({
  repo,
  files,
  edits,
  onInstall,
  isInstalling,
  prUrl,
}: {
  repo: string;
  files: CiFile[];
  edits: Record<string, string>;
  onInstall: () => void;
  isInstalling: boolean;
  prUrl: string | null;
}) {
  const t = useTranslations("ci");
  const [zipping, setZipping] = React.useState(false);
  const fileCount = files.length;

  async function handleCopyZip() {
    setZipping(true);
    try {
      const merged = mergeEdits(files, edits);
      const blob = await filesToZip(merged);
      if (typeof URL !== "undefined" && typeof URL.createObjectURL === "function") {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "devdigest-ci.zip";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }
      notify.success(t("exportWizard.zipDownloaded", { count: merged.length }));
    } finally {
      setZipping(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={s.installCard}>
        <div style={s.installCardTop}>
          <Icon.GitPullRequest size={16} />
          <span style={s.installCardTitle}>{t("exportWizard.installCardTitle")}</span>
        </div>
        <div style={s.installCardBody}>
          {t("exportWizard.installCardBody", { repo, count: fileCount })}
        </div>
        <div>
          <Button kind="primary" onClick={onInstall} loading={isInstalling} disabled={isInstalling}>
            {isInstalling ? t("exportWizard.installing") : t("exportWizard.install")}
          </Button>
        </div>
      </div>

      {prUrl && (
        <div style={s.successBox} role="status">
          <Icon.CheckCircle size={16} style={{ color: "var(--ok)" }} />
          <span>{t("exportWizard.installedPr")}</span>
          <MonoLink href={prUrl}>{t("exportWizard.viewPr")}</MonoLink>
        </div>
      )}

      <div style={s.installCard}>
        <div style={s.installCardTop}>
          <Icon.Upload size={16} />
          <span style={s.installCardTitle}>{t("exportWizard.zipCardTitle")}</span>
        </div>
        <div style={s.installCardBody}>{t("exportWizard.zipCardBody", { count: fileCount })}</div>
        <div>
          <Button kind="secondary" onClick={handleCopyZip} loading={zipping} disabled={zipping}>
            {t("exportWizard.copyZip")}
          </Button>
        </div>
      </div>

      <MonoLink href={DOCS_URL}>{t("exportWizard.docsLink")}</MonoLink>
    </div>
  );
}
