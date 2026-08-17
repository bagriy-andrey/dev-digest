"use client";

/* ExportWizard — the 4-step Export-to-CI modal (SPEC-04 §Wizard). Owns ALL
   step state here (not per-step) so Back/forward preserves every choice
   (AC-25); the Preview step's fetch (POST .../export-ci?action=files) is the
   only network call before Install, and it happens exactly once per Target
   step Continue — Back/forward within the wizard never re-fetches or drops
   the result. */
import React from "react";
import { useTranslations } from "next-intl";
import { Button, ExportWizardSteps, Modal } from "@devdigest/ui";
import type { CiFile, CiTarget } from "@/lib/types";
import { useCiInstallations, useExportCi, useSecretsStatus } from "@/lib/hooks";
import {
  DEFAULT_BASE,
  DEFAULT_POST_AS,
  DEFAULT_TRIGGERS,
  SUPPORTED_TARGET,
  WIZARD_STEP_KEYS,
  type PostAsOption,
} from "./constants";
import {
  editsToOverrideFiles,
  findConflictingInstallation,
  isValidRepo,
  isWorkflowFile,
  stepIndex,
} from "./helpers";
import { s } from "./styles";
import { TargetStep } from "./_components/TargetStep";
import { PreviewStep } from "./_components/PreviewStep";
import { ConfigureStep } from "./_components/ConfigureStep";
import { InstallStep } from "./_components/InstallStep";

export function ExportWizard({
  agentId,
  agentName,
  onClose,
}: {
  agentId: string;
  agentName: string;
  onClose: () => void;
}) {
  const t = useTranslations("ci");

  const [step, setStep] = React.useState(0);
  const [target, setTarget] = React.useState<CiTarget>(SUPPORTED_TARGET);
  const [repo, setRepo] = React.useState("");
  const [confirmReplace, setConfirmReplace] = React.useState(false);
  const [files, setFiles] = React.useState<CiFile[]>([]);
  const [selectedPath, setSelectedPath] = React.useState<string | null>(null);
  const [edits, setEdits] = React.useState<Record<string, string>>({});
  const [triggers, setTriggers] = React.useState<string[]>(DEFAULT_TRIGGERS);
  const [postAs, setPostAs] = React.useState<PostAsOption>(DEFAULT_POST_AS);
  const [prUrl, setPrUrl] = React.useState<string | null>(null);

  const { data: installations } = useCiInstallations();
  const { data: secretsStatus } = useSecretsStatus();
  const exportCi = useExportCi();
  // `undefined` while the status is still loading — only render an explicit
  // "not configured" state once we actually know it's false, never on a flash
  // of missing data. This is DevDigest's OWN GitHub PAT (Settings → API Keys),
  // a different credential from the target repo's Actions-injected GITHUB_TOKEN
  // shown in ConfigureStep's secrets table — same env-var name, two different
  // tokens, easy to conflate (see client/insights.md).
  const githubConfigured = secretsStatus?.github;

  const conflict = findConflictingInstallation(installations, repo, agentId);
  const canContinueTarget =
    target === SUPPORTED_TARGET && isValidRepo(repo) && (!conflict || confirmReplace);

  function handleEditChange(path: string, contents: string) {
    setEdits((prev) => ({ ...prev, [path]: contents }));
  }

  function handleToggleTrigger(value: string, checked: boolean) {
    setTriggers((prev) => (checked ? [...new Set([...prev, value])] : prev.filter((v) => v !== value)));
  }

  function handleContinue() {
    if (step === 0) {
      if (!canContinueTarget) return;
      exportCi.mutate(
        {
          agentId,
          input: {
            repo: repo.trim(),
            target,
            action: "files",
            post_as: postAs,
            triggers,
            base: DEFAULT_BASE,
          },
        },
        {
          onSuccess: (data) => {
            setFiles(data.files);
            const workflow = data.files.find((f) => isWorkflowFile(f.path));
            setSelectedPath(workflow?.path ?? data.files[0]?.path ?? null);
            setStep(1);
          },
        },
      );
      return;
    }
    setStep((prev) => stepIndex(prev, 1));
  }

  function handleBack() {
    setStep((prev) => stepIndex(prev, -1));
  }

  function handleInstall() {
    const overrideFiles = editsToOverrideFiles(files, edits);
    exportCi.mutate(
      {
        agentId,
        input: {
          repo: repo.trim(),
          target,
          action: "open_pr",
          post_as: postAs,
          triggers,
          base: DEFAULT_BASE,
          ...(overrideFiles.length > 0 ? { files: overrideFiles } : {}),
        },
      },
      {
        onSuccess: (data) => setPrUrl(data.pr_url),
      },
    );
  }

  const labels = WIZARD_STEP_KEYS.map((k) => t(`exportWizard.steps.${k}`));
  const isFetchingPreview = step === 0 && exportCi.isPending;

  return (
    <Modal
      title={t("exportWizard.title")}
      subtitle={t("exportWizard.subtitle", { agentName })}
      onClose={onClose}
      width={820}
      footer={
        <div style={s.footer}>
          {step > 0 && (
            <Button kind="ghost" onClick={handleBack} disabled={exportCi.isPending}>
              {t("exportWizard.back")}
            </Button>
          )}
          <div style={s.footerRight}>
            {step < 3 && (
              <Button
                kind="primary"
                onClick={handleContinue}
                disabled={step === 0 ? !canContinueTarget || isFetchingPreview : false}
                loading={isFetchingPreview}
              >
                {isFetchingPreview ? t("exportWizard.generating") : t("exportWizard.continue")}
              </Button>
            )}
          </div>
        </div>
      }
    >
      <div style={s.body}>
        <div style={s.stepsBar}>
          <ExportWizardSteps step={step} labels={labels} />
        </div>

        {step === 0 && (
          <TargetStep
            target={target}
            onTargetChange={setTarget}
            repo={repo}
            onRepoChange={setRepo}
            conflict={conflict}
            confirmReplace={confirmReplace}
            onConfirmReplaceChange={setConfirmReplace}
          />
        )}
        {step === 1 && (
          <PreviewStep
            files={files}
            edits={edits}
            onEditChange={handleEditChange}
            selectedPath={selectedPath}
            onSelectedPathChange={setSelectedPath}
          />
        )}
        {step === 2 && (
          <ConfigureStep
            triggers={triggers}
            onToggleTrigger={handleToggleTrigger}
            postAs={postAs}
            onPostAsChange={setPostAs}
            githubConfigured={githubConfigured}
          />
        )}
        {step === 3 && (
          <InstallStep
            repo={repo}
            files={files}
            edits={edits}
            onInstall={handleInstall}
            isInstalling={exportCi.isPending}
            prUrl={prUrl}
            githubConfigured={githubConfigured}
          />
        )}
      </div>
    </Modal>
  );
}
