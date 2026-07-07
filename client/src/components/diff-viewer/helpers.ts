/** Pure helpers for the DiffViewer. */
import { HUNK_HEADER_RE } from "./constants";

export interface Line {
  kind: "add" | "del" | "ctx" | "hunk";
  text: string;
  oldNo?: number;
  newNo?: number;
}

/** Parse unified-diff patch text into renderable lines with old/new line numbers. */
export function parsePatch(patch: string | null | undefined): Line[] {
  if (!patch) return [];
  const out: Line[] = [];
  let oldNo = 0;
  let newNo = 0;
  for (const raw of patch.split("\n")) {
    if (raw.startsWith("@@")) {
      const m = raw.match(HUNK_HEADER_RE);
      if (m) {
        oldNo = parseInt(m[1]!, 10);
        newNo = parseInt(m[2]!, 10);
      }
      out.push({ kind: "hunk", text: raw });
    } else if (raw.startsWith("+")) {
      out.push({ kind: "add", text: raw.slice(1), newNo });
      newNo++;
    } else if (raw.startsWith("-")) {
      out.push({ kind: "del", text: raw.slice(1), oldNo });
      oldNo++;
    } else {
      out.push({ kind: "ctx", text: raw.slice(raw.startsWith(" ") ? 1 : 0), oldNo, newNo });
      oldNo++;
      newNo++;
    }
  }
  return out;
}

/** Stable DOM id shared by `FileCard` (scroll target) and `CodeLine` (row id)
 *  so a Smart Diff findings badge can scroll to the flagged line. */
export function lineAnchorId(path: string, lineNo: number): string {
  return `smartdiff-${path}:${lineNo}`;
}

/** Stable DOM id on a `FileCard`'s root — a scroll fallback for when a
 *  requested line isn't in the rendered patch (e.g. outside any hunk). */
export function fileCardId(path: string): string {
  return `filecard-${path}`;
}
