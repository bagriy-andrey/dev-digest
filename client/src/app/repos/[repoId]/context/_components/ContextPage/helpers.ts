import type { ContextDoc } from "@/lib/types";
import { SOURCE_TYPE_ORDER, type SourceType } from "./constants";

/** Repo-relative path's final segment, e.g. "specs/SPEC-01.md" -> "SPEC-01.md". */
export function filenameOf(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? path : path.slice(idx + 1);
}

/** Group docs by source_type, in `SOURCE_TYPE_ORDER`, each group sorted by filename. */
export function groupBySourceType(docs: ContextDoc[]): Array<{ type: SourceType; docs: ContextDoc[] }> {
  const groups = new Map<SourceType, ContextDoc[]>();
  for (const doc of docs) {
    const list = groups.get(doc.source_type);
    if (list) list.push(doc);
    else groups.set(doc.source_type, [doc]);
  }
  for (const list of groups.values()) {
    list.sort((a, b) => filenameOf(a.path).localeCompare(filenameOf(b.path)));
  }
  return SOURCE_TYPE_ORDER.filter((type) => groups.has(type)).map((type) => ({
    type,
    docs: groups.get(type)!,
  }));
}

/** Compact relative time for the footer's "last <ago>" clause (e.g. "3h", "2d"). */
export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "—";
  const m = Math.max(0, Math.round((Date.now() - then) / 60_000));
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}
