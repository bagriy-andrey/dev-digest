/* MetricStrip — the recall/precision/citation trio, reused by the Evals tab,
   the per-agent dashboard, and the workspace dashboard. Renders each metric
   through the existing `MetricCard` primitive (value + signed delta + an
   optional Sparkline trend); when a metric's `_na` flag is set (D1/AC-18),
   shows the "not applicable" marker instead of a percentage. */
"use client";

import { useTranslations } from "next-intl";
import { MetricCard } from "@devdigest/ui";
import { formatMetric } from "./helpers";
import { METRIC_KEYS, type MetricKey } from "./constants";
import { s } from "./styles";

export interface MetricStripMetric {
  value: number;
  na?: boolean;
  delta?: number;
  trend?: number[];
}

export interface MetricStripProps {
  recall: MetricStripMetric;
  precision: MetricStripMetric;
  citation_accuracy: MetricStripMetric;
}

const LABEL_KEY: Record<MetricKey, string> = {
  recall: "dashboard.metrics.recall",
  precision: "dashboard.metrics.precision",
  citation_accuracy: "dashboard.metrics.citationAccuracy",
};

export function MetricStrip(props: MetricStripProps) {
  const t = useTranslations("eval");

  return (
    <div style={s.strip}>
      {METRIC_KEYS.map((key) => {
        const metric = props[key];
        const na = metric.na ?? false;
        return (
          <MetricCard
            key={key}
            label={t(LABEL_KEY[key])}
            value={
              <span title={na ? t("common.notApplicable") : undefined}>
                {formatMetric(metric.value, na)}
              </span>
            }
            delta={na ? undefined : metric.delta}
            trend={metric.trend}
          />
        );
      })}
    </div>
  );
}
