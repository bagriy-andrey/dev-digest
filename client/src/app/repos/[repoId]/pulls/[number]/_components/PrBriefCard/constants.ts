import type { IconName } from "@devdigest/ui";
import type { Brief } from "@/lib/types";

/** `Brief.risk_level` / each `risks[].severity` — not re-exported from
 *  `lib/types.ts` as a standalone `RiskSeverity` type, so derive it
 *  structurally off `Brief` rather than reaching into the vendored
 *  `@devdigest/shared` path directly (client insights convention). */
type RiskLevel = Brief["risk_level"];

/** Colour + non-colour (icon) cue per risk_level/risk severity — WCAG AA:
 *  colour alone must never be the only signal. Reuses the same theme tokens
 *  the findings SeverityBadge draws from (crit/warn/ok), just a different
 *  icon set since Brief risk levels are a distinct enum from finding
 *  severity (high|medium|low vs CRITICAL|WARNING|SUGGESTION|INFO). */
export const RISK_LEVEL_STYLE: Record<RiskLevel, { color: string; bg: string; icon: IconName }> = {
  high: { color: "var(--crit)", bg: "var(--crit-bg)", icon: "AlertOctagon" },
  medium: { color: "var(--warn)", bg: "var(--warn-bg)", icon: "AlertTriangle" },
  low: { color: "var(--ok)", bg: "var(--ok-bg)", icon: "CheckCircle" },
};
