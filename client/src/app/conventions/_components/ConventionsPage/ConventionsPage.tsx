"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, SelectInput, EmptyState, ErrorState } from "@devdigest/ui";
import { useRepos } from "@/lib/hooks";
import { useConventionCandidates, useRunExtractor } from "@/lib/hooks/conventions";
import type { ConventionCandidate } from "@devdigest/shared";
import { CandidateCard } from "../CandidateCard";
import { CreateSkillModal } from "../CreateSkillModal";
import { s } from "./styles";

export function ConventionsPage() {
  const t = useTranslations("conventions");
  const router = useRouter();

  const { data: repos } = useRepos();
  const [selectedRepoId, setSelectedRepoId] = React.useState<string>("");
  const [checked, setChecked] = React.useState<Set<string>>(new Set());
  const [showModal, setShowModal] = React.useState(false);

  const selectedRepo = repos?.find((r) => r.id === selectedRepoId) ?? null;

  const {
    data: candidates,
    isLoading: loadingCandidates,
    error: loadError,
  } = useConventionCandidates(selectedRepoId);

  const runExtractor = useRunExtractor();

  // Reset checked state when candidates change (new extraction run)
  React.useEffect(() => {
    setChecked(new Set());
  }, [candidates]);

  const repoOptions = React.useMemo(
    () => [
      { value: "", label: t("page.noRepo") },
      ...(repos ?? []).map((r) => ({ value: r.id, label: r.full_name })),
    ],
    [repos, t],
  );

  const handleExtract = async () => {
    if (!selectedRepoId) return;
    await runExtractor.mutateAsync(selectedRepoId);
  };

  const handleCheck = (id: string, isChecked: boolean) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (isChecked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const selectedCandidates: ConventionCandidate[] =
    (candidates ?? []).filter((c) => checked.has(c.id));

  const handleSkillCreated = (skillId: string) => {
    setShowModal(false);
    router.push(`/skills?id=${skillId}&tab=config`);
  };

  const isExtracting = runExtractor.isPending;
  const candidateCount = candidates?.length ?? 0;

  return (
    <div style={s.root}>
      {/* Header */}
      <div style={s.header}>
        <div style={s.headerText}>
          <h1 style={s.title}>
            {t("page.headingPrefix")}
            {selectedRepo?.name ?? t("page.repoFallback")}
          </h1>
          <p style={s.subtitle}>{t("page.subtitle")}</p>
        </div>
      </div>

      {/* Toolbar */}
      <div style={s.toolbar}>
        <SelectInput
          value={selectedRepoId}
          onChange={setSelectedRepoId}
          options={repoOptions}
          mono={false}
        />
        <Button
          kind="primary"
          icon="Search"
          loading={isExtracting}
          disabled={!selectedRepoId || isExtracting}
          onClick={handleExtract}
        >
          {isExtracting ? t("page.scanning") : candidateCount > 0 ? t("page.rescan") : t("page.runExtraction")}
        </Button>
        <Button
          kind="secondary"
          icon="Plus"
          disabled={selectedCandidates.length === 0}
          onClick={() => setShowModal(true)}
          title={selectedCandidates.length === 0 ? t("skill.createButtonHint") : undefined}
        >
          {t("skill.createButton")}
          {selectedCandidates.length > 0 ? ` (${selectedCandidates.length})` : ""}
        </Button>
      </div>

      {/* Error / loading extractor */}
      {runExtractor.isError && (
        <div style={s.extractorError}>{t("page.extractionFailed")}</div>
      )}

      {/* Candidate list */}
      {loadError ? (
        <ErrorState title={t("page.loadError")} />
      ) : !selectedRepoId || (!loadingCandidates && candidateCount === 0 && !isExtracting) ? (
        <EmptyState
          icon="ListChecks"
          title={t("page.empty.title")}
          body={t("page.empty.body")}
          cta={t("page.empty.cta")}
          onCta={selectedRepoId ? handleExtract : undefined}
          ctaLoading={isExtracting}
        />
      ) : (
        <div style={s.list}>
          {candidateCount > 0 && (
            <p style={s.countLabel}>
              {t("page.candidateCount", { count: candidateCount })}
            </p>
          )}
          {(candidates ?? []).map((candidate) => (
            <CandidateCard
              key={candidate.id}
              candidate={candidate}
              checked={checked.has(candidate.id)}
              onCheck={(v) => handleCheck(candidate.id, v)}
              repoFullName={selectedRepo?.full_name ?? ""}
              repoBranch={selectedRepo?.default_branch ?? "main"}
            />
          ))}
        </div>
      )}

      {/* Create Skill Modal */}
      {showModal && selectedRepoId && (
        <CreateSkillModal
          repoId={selectedRepoId}
          candidates={selectedCandidates}
          onClose={() => setShowModal(false)}
          onCreated={handleSkillCreated}
        />
      )}
    </div>
  );
}
