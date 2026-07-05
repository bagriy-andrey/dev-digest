/* FileCard — one collapsible file in the diff: header (path, +/- stat, comment
   count) and, when open, its parsed lines plus any outdated comments. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import type { PrFile } from "@/lib/types";
import { AUTO_EXPAND_MAX_LINES } from "../constants";
import { parsePatch, lineAnchorId, fileCardId, type Line } from "../helpers";
import {
  buildThreads,
  keysForLine,
  partitionThreads,
  type CommentThread,
  type DiffCommentApi,
} from "../comments";
import { s, chevronFor } from "../styles";
import { CodeLine } from "../CodeLine";
import { OutdatedComments } from "../OutdatedComments";

/** Threads anchored to a given parsed line (RIGHT=new, LEFT=old). */
function threadsForLine(ln: Line, matched: Map<string, CommentThread[]>): CommentThread[] {
  if (matched.size === 0) return [];
  const out: CommentThread[] = [];
  for (const key of keysForLine(ln)) {
    const list = matched.get(key);
    if (list) out.push(...list);
  }
  return out;
}

export function FileCard({
  file,
  commenting,
  findingLines,
  scrollToLine,
  openSignal,
}: {
  file: PrFile;
  commenting?: DiffCommentApi;
  /** Smart Diff findings overlay: new-side line numbers flagged by the most
   *  recent review. Renders a clickable badge that expands the card and
   *  scrolls to the first flagged line. */
  findingLines?: number[];
  /** External navigation target (e.g. clicking a finding in Agent runs):
   *  new-side line to highlight + scroll to. Only meaningful when `openSignal`
   *  is set for this file. */
  scrollToLine?: number | null;
  /** Nonce — when it changes, force the card open and scroll to `scrollToLine`
   *  (or the card header if unset/not found). Undefined means "not the target". */
  openSignal?: number;
}) {
  const t = useTranslations("shell");
  const [open, setOpen] = React.useState(
    (file.additions ?? 0) + (file.deletions ?? 0) <= AUTO_EXPAND_MAX_LINES
  );
  const lines = React.useMemo(() => parsePatch(file.patch), [file.patch]);
  const highlightLines = React.useMemo(() => {
    const set = new Set<number>(findingLines ?? []);
    if (scrollToLine != null) set.add(scrollToLine);
    return set.size ? set : undefined;
  }, [findingLines, scrollToLine]);

  React.useEffect(() => {
    if (openSignal == null) return;
    setOpen(true);
    requestAnimationFrame(() => {
      const id = scrollToLine != null ? lineAnchorId(file.path, scrollToLine) : fileCardId(file.path);
      const el = document.getElementById(id) ?? document.getElementById(fileCardId(file.path));
      el?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openSignal]);

  // Group this file's comments into threads, then split into ones we can anchor
  // to a rendered line vs. "outdated" (GitHub dropped the line / it's not here).
  const comments = commenting?.comments;
  const { matched, outdated } = React.useMemo(() => {
    if (!comments) return { matched: new Map<string, CommentThread[]>(), outdated: [] };
    const fileThreads = buildThreads(comments.filter((c) => c.path === file.path));
    const renderedKeys = new Set<string>();
    for (const ln of lines) for (const k of keysForLine(ln)) renderedKeys.add(k);
    return partitionThreads(fileThreads, renderedKeys);
  }, [comments, file.path, lines]);

  const commentCount = commenting
    ? commenting.comments.filter((c) => c.path === file.path).length
    : 0;

  return (
    <div id={fileCardId(file.path)} style={{ ...s.fileCard, scrollMarginTop: 16 }}>
      <div onClick={() => setOpen((o) => !o)} style={s.fileHeader}>
        <Icon.ChevronRight size={13} style={chevronFor(open)} />
        <Icon.FileText size={14} style={s.fileIcon} />
        <span className="mono" style={s.filePath}>
          {file.path}
        </span>
        <span className="mono tnum" style={s.fileStat}>
          <span style={s.addText}>+{file.additions}</span>{" "}
          <span style={s.delText}>−{file.deletions}</span>
        </span>
        {commentCount > 0 && (
          <span
            style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, color: "var(--text-muted)" }}
          >
            <Icon.MessageSquare size={12} />
            {commentCount}
          </span>
        )}
        {!!findingLines?.length && (
          <button
            type="button"
            style={s.findingsBadge}
            title={t("diffViewer.smart.findingsBadge", { count: findingLines.length })}
            onClick={(e) => {
              e.stopPropagation();
              setOpen(true);
              const firstLine = findingLines[0]!;
              requestAnimationFrame(() => {
                document
                  .getElementById(lineAnchorId(file.path, firstLine))
                  ?.scrollIntoView({ block: "center" });
              });
            }}
          >
            <Icon.AlertTriangle size={12} />
            {t("diffViewer.smart.findingsBadge", { count: findingLines.length })}
          </button>
        )}
      </div>
      {open && (
        <div style={s.fileBody}>
          {lines.length === 0 ? (
            <div style={s.noDiff}>{t("diffViewer.noDiffText")}</div>
          ) : (
            lines.map((ln, i) => (
              <CodeLine
                key={i}
                ln={ln}
                path={file.path}
                threads={threadsForLine(ln, matched)}
                commenting={commenting}
                highlightLines={highlightLines}
              />
            ))
          )}
          {commenting && commenting.showComments && <OutdatedComments threads={outdated} />}
        </div>
      )}
    </div>
  );
}
