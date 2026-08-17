import type { IconName } from "@devdigest/ui";

/** Compact relative time for an installation's latest-run timestamp
 *  (e.g. "3h", "2d"), or `null` when there's no timestamp — the caller
 *  renders `ciTab.never` for that case. Mirrors the shape of
 *  `ContextPage/helpers.ts`'s `relativeTime`, colocated here rather than
 *  shared since it's a small, presentation-only pure function. */
export function relativeTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return null;
  const m = Math.max(0, Math.round((Date.now() - then) / 60_000));
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}

/** Icon + i18n label key + theme colour for a CI run's status — text/icon
 *  cue, never colour alone (AC-35/AC-37). `null`/unknown status (e.g. an
 *  installation with no runs yet) reads as "never" upstream, not here. */
export function runStatusMeta(status: string | null | undefined): {
  icon: IconName;
  labelKey: string;
  color: string;
} {
  switch (status) {
    case "succeeded":
      return { icon: "CheckCircle", labelKey: "runs.status.succeeded", color: "var(--ok)" };
    case "no_findings":
      return { icon: "CheckCircle", labelKey: "runs.status.noFindings", color: "var(--text-secondary)" };
    case "failed":
      return { icon: "XCircle", labelKey: "runs.status.failed", color: "var(--crit)" };
    case "running":
      return { icon: "RefreshCw", labelKey: "runs.status.running", color: "var(--warn)" };
    default:
      return { icon: "Clock", labelKey: "ciTab.never", color: "var(--text-muted)" };
  }
}
