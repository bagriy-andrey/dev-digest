/** Pure helpers for the eval components — no I/O, no React. Unit-tested in
 *  `helpers.test.ts`. */
import type { EvalBatchSummary } from "@/lib/types";
import { METRIC_KEYS, type MetricKey } from "./constants";

/** `92%` normally, `"—"` when the metric's denominator was zero (D1/AC-18) —
 *  a stored `1` is otherwise indistinguishable from a genuine 100%. */
export function formatMetric(value: number, na: boolean): string {
  if (na) return "—";
  return `${Math.round(value * 100)}%`;
}

/** Reads the right `<metric>_na` flag off an `EvalBatchSummary`-shaped object,
 *  keeping callers from hand-rolling a dynamic-key lookup. */
export function metricNa(
  summary: Pick<EvalBatchSummary, "recall_na" | "precision_na" | "citation_accuracy_na">,
  key: MetricKey,
): boolean {
  switch (key) {
    case "recall":
      return summary.recall_na;
    case "precision":
      return summary.precision_na;
    case "citation_accuracy":
      return summary.citation_accuracy_na;
  }
}

/** A fraction delta (e.g. `0.04`) rendered as signed percentage points, using
 *  a true minus sign (not a hyphen) for negative values: `"+4pt"` / `"−2pt"`. */
export function signedDelta(d: number): string {
  const pts = Math.round(d * 100);
  if (pts === 0) return "0pt";
  return pts > 0 ? `+${pts}pt` : `−${Math.abs(pts)}pt`;
}

export interface MovementResult {
  metric: MetricKey;
  direction: "up" | "down";
  delta: number;
}

type MetricValues = Record<MetricKey, number>;

/** D2/AC-34 — the largest single metric movement between two batches, as a
 *  CLIENT pure function (never a server-composed string, so it can be
 *  rendered through i18n). `previous: null` (no prior batch) or "nothing
 *  moved" both yield `null`. Pure + deterministic: identical inputs always
 *  produce an identical result. */
export function largestMovement(
  current: MetricValues,
  previous: MetricValues | null,
): MovementResult | null {
  if (!previous) return null;

  let best: MovementResult | null = null;
  for (const metric of METRIC_KEYS) {
    const delta = current[metric] - previous[metric];
    if (delta === 0) continue;
    if (!best || Math.abs(delta) > Math.abs(best.delta)) {
      best = { metric, direction: delta > 0 ? "up" : "down", delta };
    }
  }
  return best;
}
