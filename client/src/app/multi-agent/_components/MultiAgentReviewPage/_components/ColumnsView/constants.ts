import type { IconName } from "@devdigest/ui";
import type { AgentColumn } from "@/lib/types";

/** Status → icon (never colour alone — a11y). */
export const STATUS_ICON: Record<AgentColumn["status"], IconName> = {
  running: "RefreshCw",
  done: "CheckCircle",
  failed: "XCircle",
};

export const STATUS_COLOR: Record<AgentColumn["status"], string> = {
  running: "var(--text-muted)",
  done: "var(--ok)",
  failed: "var(--crit)",
};
