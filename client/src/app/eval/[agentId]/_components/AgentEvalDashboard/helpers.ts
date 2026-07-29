/** Pure helpers for the per-agent eval dashboard — no I/O, no React. */
import type { EvalBatchSummary } from "@/lib/types";
import type { MetricKey } from "@/components/eval";
import { MAX_COMPARE_SELECTION } from "./constants";

/** AC-27 — toggling a batch's compare checkbox. Selecting beyond
 *  `MAX_COMPARE_SELECTION` is a no-op (a third selection is prevented, not
 *  an error); unchecking always works. Pure so "a third is prevented" is
 *  unit-testable without rendering a `Checkbox` at all. */
export function toggleBatchSelection(
  selected: string[],
  batchId: string,
  checked: boolean,
): string[] {
  if (!checked) return selected.filter((id) => id !== batchId);
  if (selected.includes(batchId)) return selected;
  if (selected.length >= MAX_COMPARE_SELECTION) return selected;
  return [...selected, batchId];
}

export type MetricValues = Record<MetricKey, number>;

/** `EvalDashboard.current` and `EvalBatchSummary` both carry
 *  `recall`/`precision`/`citation_accuracy` fields verbatim — pick just
 *  those three so the result matches `largestMovement`'s `MetricValues`
 *  shape exactly (extra fields on the source, e.g. `cost_usd`, are fine to
 *  drop). */
export function metricValuesOf(source: {
  recall: number;
  precision: number;
  citation_accuracy: number;
}): MetricValues {
  return {
    recall: source.recall,
    precision: source.precision,
    citation_accuracy: source.citation_accuracy,
  };
}

/** Reads the three `_na` flags off the latest batch (D1/AC-18); defaults to
 *  "not applicable" (`true`) when there is no batch yet at all. */
export function naFlagsOf(
  latestBatch:
    | Pick<EvalBatchSummary, "recall_na" | "precision_na" | "citation_accuracy_na">
    | undefined
    | null,
): Record<MetricKey, boolean> {
  return {
    recall: latestBatch?.recall_na ?? true,
    precision: latestBatch?.precision_na ?? true,
    citation_accuracy: latestBatch?.citation_accuracy_na ?? true,
  };
}
