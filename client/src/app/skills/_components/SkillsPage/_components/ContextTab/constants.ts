import type { IconName } from "@devdigest/ui";
import type { ContextDoc } from "@/lib/types";

/** `ContextDoc.source_type` ("specs" | "docs" | "insights"). Derived via
 *  indexed access (mirrors the Agent Context tab's `constants.ts`) so this
 *  folder doesn't need a new export added to `lib/types.ts`. */
export type SourceType = ContextDoc["source_type"];

/** Icon shown next to each row's source-folder badge, keyed by source_type. */
export const SOURCE_TYPE_ICON: Record<SourceType, IconName> = {
  specs: "FileText",
  docs: "File",
  insights: "Lightbulb",
};
