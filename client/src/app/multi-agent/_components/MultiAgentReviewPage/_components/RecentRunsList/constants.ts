import type { IconName } from "@devdigest/ui";
import type { MultiAgentGroupSummary } from "@/lib/types";

/** Status → color/bg/icon — never colour alone (a11y). Mirrors
 *  ColumnsView/constants.ts's per-column STATUS_COLOR/STATUS_ICON, extended
 *  with a background tint since these render as `Badge`s, not plain text. */
export const GROUP_STATUS: Record<
  MultiAgentGroupSummary["status"],
  { color: string; bg: string; icon: IconName }
> = {
  running: { color: "var(--accent)", bg: "var(--accent-bg)", icon: "RefreshCw" },
  done: { color: "var(--ok)", bg: "var(--ok-bg)", icon: "CheckCircle" },
  failed: { color: "var(--crit)", bg: "var(--crit-bg)", icon: "XCircle" },
};
