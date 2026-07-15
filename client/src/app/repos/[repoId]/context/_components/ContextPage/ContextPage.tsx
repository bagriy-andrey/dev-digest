"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Skeleton, ErrorState, EmptyState } from "@devdigest/ui";
import { useContextFiles, useReindexContext } from "@/lib/hooks";
import { ApiError } from "@/lib/api";
import { groupBySourceType } from "./helpers";
import { s } from "./styles";
import { DocListItem } from "./_components/DocListItem";
import { DocPreview } from "./_components/DocPreview";
import { IndexFooter } from "./_components/IndexFooter";

/** Project Context page (Screen 1, SPEC-01): left doc list grouped by
 *  source_type, right VIEW-ONLY Markdown preview, footer index status +
 *  Re-index trigger. */
export function ContextPage({ repoId }: { repoId: string }) {
  const t = useTranslations("context");
  const { data: docs, isLoading, isError, error, refetch } = useContextFiles(repoId);
  const reindex = useReindexContext();
  const [selectedPath, setSelectedPath] = React.useState<string | null>(null);
  const [scannedAt, setScannedAt] = React.useState<string | null>(null);

  const groups = React.useMemo(() => groupBySourceType(docs ?? []), [docs]);
  const selected = (docs ?? []).find((d) => d.path === selectedPath) ?? docs?.[0] ?? null;
  const isEmpty = !isLoading && !isError && (docs ?? []).length === 0;

  const files = docs?.length ?? 0;
  const chunks = (docs ?? []).reduce((sum, d) => sum + d.headings, 0);

  const handleReindex = () => {
    reindex.mutate(repoId, {
      onSuccess: (status) => setScannedAt(status.scanned_at),
    });
  };

  return (
    <div style={s.root}>
      {isEmpty ? (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <EmptyState icon="FileText" title={t("empty.title")} body={t("empty.body")} />
        </div>
      ) : (
        <div style={s.body}>
          {/* Left panel */}
          <div style={s.left}>
            <div style={s.leftHeader}>
              <span style={s.leftTitle}>{t("title")}</span>
            </div>
            <div style={s.list}>
              {isLoading ? (
                <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
                  <Skeleton height={20} />
                  <Skeleton height={20} />
                  <Skeleton height={20} />
                </div>
              ) : isError ? (
                <ErrorState
                  title={t("loadError")}
                  body={error instanceof ApiError ? error.message : undefined}
                  onRetry={() => refetch()}
                />
              ) : (
                groups.map((group) => (
                  <div key={group.type}>
                    <div style={s.groupLabel}>{t(`sourceType.${group.type}`)}</div>
                    {group.docs.map((doc) => (
                      <DocListItem
                        key={doc.path}
                        doc={doc}
                        active={doc.path === selected?.path}
                        onClick={() => setSelectedPath(doc.path)}
                      />
                    ))}
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Right panel */}
          <div style={s.right}>
            {selected ? (
              <DocPreview repoId={repoId} doc={selected} />
            ) : (
              <div style={s.selectPrompt}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>
                    {t("selectPrompt.title")}
                  </div>
                  <div style={{ fontSize: 13 }}>{t("selectPrompt.body")}</div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <IndexFooter
        files={files}
        chunks={chunks}
        scannedAt={scannedAt}
        onReindex={handleReindex}
        reindexing={reindex.isPending}
      />
    </div>
  );
}
