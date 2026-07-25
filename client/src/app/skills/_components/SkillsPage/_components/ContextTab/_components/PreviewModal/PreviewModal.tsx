"use client";

import { useTranslations } from "next-intl";
import { Markdown, Skeleton, ErrorState, Modal } from "@devdigest/ui";
import { useContextFile } from "@/lib/hooks/context";
import { filenameOf } from "../../helpers";

/** View-only Markdown preview of a doc, fetched on demand (mirrors the
 *  Project Context page's `DocPreview` and the Agent Context tab's
 *  `PreviewModal` — AC-6/AC-10/AC-13 — no edit affordance). */
export function PreviewModal({
  repoId,
  path,
  onClose,
}: {
  repoId: string | null;
  path: string;
  onClose: () => void;
}) {
  const t = useTranslations("skills");
  const { data, isLoading, isError, refetch } = useContextFile(repoId, path);

  return (
    <Modal title={filenameOf(path)} subtitle={path} onClose={onClose} width={720}>
      {isLoading ? (
        <div style={{ padding: 24 }}>
          <Skeleton height={200} />
        </div>
      ) : isError ? (
        <div style={{ padding: 24 }}>
          <ErrorState title={t("context.previewError")} onRetry={() => refetch()} />
        </div>
      ) : (
        <div style={{ padding: 24, color: "var(--text-primary)" }}>
          <Markdown>{data?.content}</Markdown>
        </div>
      )}
    </Modal>
  );
}
