"use client";

import { useTranslations } from "next-intl";
import { Button } from "@devdigest/ui";
import { relativeTime } from "../../helpers";
import { s } from "../../styles";

/**
 * Footer status bar (AC-9): "Indexed: N files · M chunks · last <ago> ago" +
 * the Re-index trigger (AC-4). `scannedAt` is only known once a reindex has
 * completed IN THIS SESSION — the API has no GET endpoint for the persisted
 * `repo_context_index.scanned_at` row on initial page load (server module,
 * out of this step's scope), so before that we render the counts without the
 * "last … ago" clause rather than fabricate a timestamp.
 */
export function IndexFooter({
  files,
  chunks,
  scannedAt,
  onReindex,
  reindexing,
}: {
  files: number;
  chunks: number;
  scannedAt: string | null;
  onReindex: () => void;
  reindexing: boolean;
}) {
  const t = useTranslations("context");
  return (
    <div style={s.footer}>
      <span>
        {scannedAt
          ? t("indexed", { files, chunks, ago: relativeTime(scannedAt) })
          : t("indexedUnknown", { files, chunks })}
      </span>
      <div style={{ marginLeft: "auto" }}>
        <Button
          kind="secondary"
          size="sm"
          icon="RefreshCw"
          onClick={onReindex}
          loading={reindexing}
        >
          {reindexing ? t("indexing") : t("reindex")}
        </Button>
      </div>
    </div>
  );
}
