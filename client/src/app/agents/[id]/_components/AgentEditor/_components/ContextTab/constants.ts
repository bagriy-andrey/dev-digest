import type { IconName } from "@devdigest/ui";
import type { ContextDoc } from "@/lib/types";

/** `ContextDoc.source_type` ("specs" | "docs" | "insights"). Derived via
 *  indexed access (mirrors `repos/[repoId]/context`'s `ContextPage/constants.ts`)
 *  so this folder doesn't need a new export added to `lib/types.ts`. */
export type SourceType = ContextDoc["source_type"];

/** Icon shown next to each row's source-folder badge, keyed by source_type. */
export const SOURCE_TYPE_ICON: Record<SourceType, IconName> = {
  specs: "FileText",
  docs: "File",
  insights: "Lightbulb",
};

/** Client-side token estimate heuristic (AC-12): chars / 4. This is NOT the
 *  server-measured value (`RunStats.specs_tokens`, AC-23, tiktoken-based) —
 *  intentional divergence, see plan §5. */
export const CHARS_PER_TOKEN_ESTIMATE = 4;
