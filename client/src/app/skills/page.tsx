import React from "react";
import { AppShell } from "@/components/app-shell";
import { SkillsPage } from "./_components/SkillsPage";

export default function SkillsRoute({
  searchParams,
}: {
  searchParams: Promise<{ id?: string; tab?: string }>;
}) {
  const crumb = [{ label: "Skills Lab" }, { label: "Skills" }];
  return (
    <AppShell crumb={crumb}>
      <React.Suspense fallback={null}>
        <SkillsPageWrapper searchParams={searchParams} />
      </React.Suspense>
    </AppShell>
  );
}

async function SkillsPageWrapper({
  searchParams,
}: {
  searchParams: Promise<{ id?: string; tab?: string }>;
}) {
  const sp = await searchParams;
  return <SkillsPage initialId={sp.id} initialTab={sp.tab} />;
}
