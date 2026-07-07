"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { SectionLabel, Button } from "@devdigest/ui";
import { DiffViewer, SmartDiffViewer, type DiffCommentApi } from "@/components/diff-viewer";
import { usePrComments, useCreatePrComment } from "@/lib/hooks/reviews";
import { useSmartDiff } from "@/lib/hooks/smart-diff";
import { notify } from "@/lib/toast";
import type { PrFile } from "@devdigest/shared";

interface DiffTabProps {
  prId: string | null;
  filesCount: number;
  files: PrFile[];
  /** Inline commenting is offered only on open PRs (GitHub rejects otherwise). */
  canComment?: boolean;
  /** External navigation target (e.g. from a finding's file:line link in
   *  Agent runs) — opens the file and scrolls to the line, in whichever
   *  viewer (Smart/Original) is active. */
  targetFile?: string | null;
  targetLine?: number | null;
  targetNonce?: number;
}

export function DiffTab({
  prId,
  filesCount,
  files,
  canComment,
  targetFile,
  targetLine,
  targetNonce,
}: DiffTabProps) {
  const t = useTranslations("shell");
  const { data: comments } = usePrComments(prId);
  const create = useCreatePrComment(prId);
  const { data: smartDiff } = useSmartDiff(prId);
  // Comments start hidden so the diff is clean by default — toggle to reveal.
  const [showComments, setShowComments] = React.useState(false);
  // Smart Diff is always available even with zero reviews, so default to it;
  // falls back to the flat viewer while it's loading/undefined.
  const [order, setOrder] = React.useState<"smart" | "original">("smart");

  const commentCount = comments?.length ?? 0;

  const commenting: DiffCommentApi = {
    comments: comments ?? [],
    canComment: !!canComment && !!prId,
    showComments,
    posting: create.isPending,
    onSubmit: async (input) => {
      try {
        const res = await create.mutateAsync(input);
        setShowComments(true); // a just-posted comment shouldn't stay hidden
        return res;
      } catch (err) {
        notify.error(err instanceof Error ? err.message : "Couldn't post the comment to GitHub.");
        throw err;
      }
    },
  };

  return (
    <section>
      <SectionLabel
        icon="Code"
        right={
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Button
              kind="tertiary"
              active={order === "smart"}
              size="sm"
              onClick={() => setOrder("smart")}
            >
              {t("diffViewer.smart.orderSmart")}
            </Button>
            <Button
              kind="tertiary"
              active={order === "original"}
              size="sm"
              onClick={() => setOrder("original")}
            >
              {t("diffViewer.smart.orderOriginal")}
            </Button>
            {commentCount > 0 && (
              <Button
                kind="ghost"
                size="sm"
                icon={showComments ? "EyeOff" : "Eye"}
                onClick={() => setShowComments((v) => !v)}
              >
                {showComments ? "Hide comments" : "Show comments"} ({commentCount})
              </Button>
            )}
          </div>
        }
      >
        Files changed · {filesCount} files
      </SectionLabel>
      {order === "smart" && smartDiff ? (
        <SmartDiffViewer
          smartDiff={smartDiff}
          files={files}
          commenting={commenting}
          targetFile={targetFile}
          targetLine={targetLine}
          targetNonce={targetNonce}
        />
      ) : (
        <DiffViewer
          files={files}
          commenting={commenting}
          targetFile={targetFile}
          targetLine={targetLine}
          targetNonce={targetNonce}
        />
      )}
    </section>
  );
}
