import type { IconName } from "@devdigest/ui";

/** Cost formatting for a CI run — a genuinely unknown cost (the provider
 *  never reported one) renders `unknownLabel` (an i18n'd "unknown"), never
 *  "$0.00" or a fabricated value (AC-41). */
export function formatRunCost(usd: number | null | undefined, unknownLabel: string): string {
  if (usd == null) return unknownLabel;
  return `$${usd.toFixed(usd < 1 ? 3 : 2)}`;
}

/** Duration formatting (input in seconds, `CiRun.duration_s`) — an
 *  unavailable duration renders `unknownLabel`, never "0s" (AC-41). */
export function formatRunDuration(seconds: number | null | undefined, unknownLabel: string): string {
  if (seconds == null) return unknownLabel;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}m ${s}s`;
}

/** Icon + i18n label key + theme colour for a CI run's status — text/icon
 *  cue, never colour alone (AC-35). A missing/unrecognised status (should
 *  not happen post AC-49, but the UI must not crash on it) falls back to a
 *  generic "unknown" reading. */
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
      return { icon: "Clock", labelKey: "runs.unknown", color: "var(--text-muted)" };
  }
}
