"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, EmptyState, ErrorState, Skeleton } from "@devdigest/ui";
import { useOnboarding, useGenerateOnboarding, useRepoIntelStatus } from "@/lib/hooks";
import { ApiError } from "@/lib/api";
import { COPY_RESET_MS } from "./constants";
import { isStale } from "./helpers";
import { s } from "./styles";
import { Section } from "./_components/Section";

/**
 * Onboarding Tour page (SPEC-01-onboarding-generator, Step 5): view-only
 * five-section repo tour. Empty state + Generate CTA when no document has
 * ever been generated (AC-17/AC-20); loaded state renders the five sections
 * in server-guaranteed order (AC-16) plus a stale indicator (AC-14),
 * Regenerate (AC-20) and Copy link (AC-19). No cost figure is rendered
 * anywhere — the `OnboardingDoc` response contract structurally carries none
 * (AC-15).
 */
export function OnboardingPage({ repoId }: { repoId: string }) {
  const t = useTranslations("onboarding");
  const { data: doc, isLoading, isError, error, refetch } = useOnboarding(repoId);
  const { data: indexState } = useRepoIntelStatus(repoId);
  const generate = useGenerateOnboarding(repoId);

  const [copied, setCopied] = React.useState(false);
  const copyTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear any pending "copied!" reset on unmount so it never fires state
  // updates after this component is gone (client convention).
  React.useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
    };
  }, []);

  const handleCopyLink = () => {
    void navigator.clipboard?.writeText(window.location.href);
    setCopied(true);
    if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
    copyTimeoutRef.current = setTimeout(() => setCopied(false), COPY_RESET_MS);
  };

  if (isLoading) {
    return (
      <div style={s.loadingWrap}>
        <Skeleton height={24} />
        <Skeleton height={160} />
        <Skeleton height={160} />
      </div>
    );
  }

  if (isError) {
    return (
      <ErrorState
        title={t("loadError.title")}
        body={error instanceof ApiError ? error.message : t("unknownError")}
        onRetry={() => refetch()}
        fullScreen
      />
    );
  }

  const onboarding = doc?.onboarding ?? null;
  const stale = isStale(doc?.source_sha, indexState?.lastIndexedSha);

  // Empty state (AC-17/AC-20): never an error for "not yet generated".
  if (!onboarding) {
    return (
      <div style={s.emptyWrap}>
        <EmptyState
          icon="Workflow"
          title={t("generate.title")}
          body={t("generate.body")}
          cta={generate.isPending ? t("generate.generating") : t("generate.cta")}
          onCta={() => generate.mutate()}
          ctaLoading={generate.isPending}
        />
      </div>
    );
  }

  return (
    <div style={s.root}>
      <div style={s.header}>
        <span style={s.headerTitle}>
          {t("sectionCount", { count: onboarding.sections.length })}
        </span>
        {stale && (
          <Badge icon="AlertTriangle" color="var(--warn)" bg="var(--warn-bg)">
            {t("stale.label")}
          </Badge>
        )}
        <Button
          kind="secondary"
          size="sm"
          icon={copied ? "Check" : "Copy"}
          onClick={handleCopyLink}
        >
          {copied ? t("copied") : t("copyLink")}
        </Button>
        <Button
          kind="secondary"
          size="sm"
          icon="RefreshCw"
          onClick={() => generate.mutate()}
          loading={generate.isPending}
        >
          {generate.isPending ? t("regenerating") : t("regenerate")}
        </Button>
      </div>

      {stale && (
        <div style={{ padding: "10px 28px 0" }}>
          <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>{t("stale.body")}</span>
        </div>
      )}

      <div style={s.body}>
        {onboarding.sections.map((section, i) => (
          <Section key={`${section.kind}-${i}`} section={section} />
        ))}
      </div>
    </div>
  );
}
