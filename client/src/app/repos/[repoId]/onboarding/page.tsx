/* Onboarding Tour — /repos/:repoId/onboarding (SPEC-01-onboarding-generator,
   AC-18). Stable, bookmarkable, repo-scoped in-app URL; no new public/
   unauthenticated route. Thin wrapper mirroring context/page.tsx: delegates
   to the co-located OnboardingPage for the actual view. */
"use client";

import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { AppShell } from "@/components/app-shell";
import { RepoNotFound } from "@/components/repo-not-found";
import { useActiveRepo, useRepoNotFound } from "@/lib/repo-context";
import { OnboardingPage } from "./_components/OnboardingPage";

export default function OnboardingTourPage() {
  const t = useTranslations("onboarding");
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
      <OnboardingPage repoId={repoId} />
    </AppShell>
  );
}
