import type { EvalExpectation } from "@/lib/types";

/** Inserted by the "+ Finding skeleton" button in `CaseEditorModal` — a blank
 *  `must_find` stub whose field names exactly match `EvalExpectation`
 *  (`contracts/eval-ci.ts`), so hand-authoring a case needs less typing than
 *  writing the JSON object from scratch. */
export const FINDING_SKELETON: EvalExpectation = {
  kind: "must_find",
  file: "",
  start_line: 1,
  end_line: 1,
  severity: "WARNING",
  category: "bug",
  title: "",
};

/** Sub-tabs of the case editor's read-only "Input" section. */
export const INPUT_TABS = ["diff", "files", "prMeta"] as const;
export type InputTab = (typeof INPUT_TABS)[number];
