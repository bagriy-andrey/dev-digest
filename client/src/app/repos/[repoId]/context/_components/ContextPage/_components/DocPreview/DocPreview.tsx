"use client";

import { useTranslations } from "next-intl";
import { Badge, Markdown, Skeleton, ErrorState, Icon } from "@devdigest/ui";
import type { ContextDoc } from "@/lib/types";
import { useContextFile } from "@/lib/hooks/context";
import { filenameOf } from "../../helpers";
import { SOURCE_TYPE_ICON } from "../../constants";
import { s } from "../../styles";

/** Right panel — VIEW-ONLY Markdown preview of the selected doc (AC-6: no edit
 *  affordance). Header shows "Used by N agents" (AC-7) + COVERAGE % (AC-8). */
export function DocPreview({ repoId, doc }: { repoId: string; doc: ContextDoc }) {
  const t = useTranslations("context");
  const { data, isLoading, isError, refetch } = useContextFile(repoId, doc.path);
  const I = Icon[SOURCE_TYPE_ICON[doc.source_type]];

  return (
    <>
      <div style={s.previewHeader}>
        <I size={16} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
        <span style={s.previewTitle}>{filenameOf(doc.path)}</span>
        <Badge icon="Users">{t("usedBy", { count: doc.used_by })}</Badge>
        <Badge mono>
          {t("coverage")} {doc.coverage}%
        </Badge>
      </div>
      <div style={s.previewBody}>
        {isLoading ? (
          <Skeleton height={200} />
        ) : isError ? (
          <ErrorState title={t("previewError")} onRetry={() => refetch()} />
        ) : (
          <div style={s.previewCard}>
            <Markdown>{data?.content}</Markdown>
          </div>
        )}
      </div>
    </>
  );
}
