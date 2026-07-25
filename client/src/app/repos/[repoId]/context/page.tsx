/* Project Context — /repos/:repoId/context (SPEC-01, Screen 1). Left: doc list
   grouped by source_type (specs/docs/insights). Right: view-only Markdown
   preview via useContextFile (AC-6 — no edit affordance). Footer: index status
   + Re-index (AC-4/AC-9). */
"use client";

import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { AppShell } from "@/components/app-shell";
import { RepoNotFound } from "@/components/repo-not-found";
import { useActiveRepo, useRepoNotFound } from "@/lib/repo-context";
import { ContextPage } from "./_components/ContextPage";

export default function ProjectContextPage() {
  const t = useTranslations("context");
  const params = useParams<{ repoId: string }>();
  const repoId = params.repoId;
  const { activeRepo } = useActiveRepo();
  const repoNotFound = useRepoNotFound(repoId);
  const repoName = activeRepo?.full_name ?? repoId;

  if (repoNotFound) {
    return (
      <AppShell crumb={[{ label: repoName, mono: true }, { label: t("title") }]}>
        <RepoNotFound />
      </AppShell>
    );
  }

  return (
    <AppShell crumb={[{ label: repoName, mono: true }, { label: t("title") }]}>
      <ContextPage repoId={repoId} />
    </AppShell>
  );
}
