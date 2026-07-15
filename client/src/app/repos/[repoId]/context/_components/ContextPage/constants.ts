import type { IconName } from "@devdigest/ui";
import type { ContextDoc } from "@/lib/types";

/** `ContextDoc.source_type` ("specs" | "docs" | "insights") — derived via indexed
 *  access rather than importing `ContextSourceType` so this folder doesn't need
 *  a new export added to `lib/types.ts` (outside this step's file list). */
export type SourceType = ContextDoc["source_type"];

/** Display order for the left-panel source-type groups (mirrors the server's
 *  `DEFAULT_CONTEXT_FOLDERS` discovery order). */
export const SOURCE_TYPE_ORDER: readonly SourceType[] = ["specs", "docs", "insights"];

/** Icon shown next to each doc row / group header, keyed by source_type. */
export const SOURCE_TYPE_ICON: Record<SourceType, IconName> = {
  specs: "FileText",
  docs: "File",
  insights: "Lightbulb",
};
