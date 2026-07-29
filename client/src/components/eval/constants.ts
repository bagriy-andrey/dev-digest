/** Shared constants for the cross-route eval components (`MetricStrip`,
 *  `DeltaChip`, and the `helpers.ts` pure functions steps 8/9 build on). */

/** The three metrics every eval batch/dashboard reports. Field names match
 *  `EvalBatchSummary`/`EvalDashboard.current` verbatim. */
export const METRIC_KEYS = ["recall", "precision", "citation_accuracy"] as const;
export type MetricKey = (typeof METRIC_KEYS)[number];

/** `dashboard.movement.*` in `eval.json` uses a shorter "citation" segment for
 *  `citation_accuracy` — map the data field name to its i18n segment. */
export const MOVEMENT_I18N_SEGMENT: Record<MetricKey, "recall" | "precision" | "citation"> = {
  recall: "recall",
  precision: "precision",
  citation_accuracy: "citation",
};
