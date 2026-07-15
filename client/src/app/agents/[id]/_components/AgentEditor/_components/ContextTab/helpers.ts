import type { ContextAttachment, ContextDoc } from "@/lib/types";
import { CHARS_PER_TOKEN_ESTIMATE } from "./constants";

/** Repo-relative path's final segment, e.g. "specs/SPEC-01.md" -> "SPEC-01.md". */
export function filenameOf(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? path : path.slice(idx + 1);
}

/**
 * Row display order: attached docs first (in their persisted `order`),
 * followed by every other discovered doc alphabetically by filename. Mirrors
 * `SkillsTab`'s linked-then-available split, merged into one sortable list
 * since this tab shows a row per DISCOVERED doc rather than two panels.
 * Docs referenced by an attachment but no longer discovered (deleted
 * upstream) are dropped — nothing to render a row for.
 */
export function buildOrderedPaths(docs: ContextDoc[], attachments: ContextAttachment[]): string[] {
  const docPaths = new Set(docs.map((d) => d.path));
  const attachedOrdered = [...attachments]
    .filter((a) => docPaths.has(a.path))
    .sort((a, b) => a.order - b.order)
    .map((a) => a.path);
  const attachedSet = new Set(attachedOrdered);
  const rest = docs
    .filter((d) => !attachedSet.has(d.path))
    .sort((a, b) => filenameOf(a.path).localeCompare(filenameOf(b.path)))
    .map((d) => d.path);
  return [...attachedOrdered, ...rest];
}

/** Approximate token count (AC-12 client heuristic): total char size / 4. */
export function estimateTokens(docs: ContextDoc[], attachedPaths: readonly string[]): number {
  const attached = new Set(attachedPaths);
  const totalChars = docs.filter((d) => attached.has(d.path)).reduce((sum, d) => sum + d.size, 0);
  return Math.round(totalChars / CHARS_PER_TOKEN_ESTIMATE);
}
