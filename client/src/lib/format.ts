/** Display formatters shared across screens (cost, tokens). Kept here, not in a
 *  drawer-local helpers file, because cost is rendered on the PR list, the run
 *  timeline AND the trace drawer. */

/**
 * USD cost → "$0.013" / "$1.42". `null`/`undefined` means "no data" and renders
 * an em dash — NEVER "$0.00" (a missing cost must not read as a free run). A
 * genuine zero (e.g. a free model) is real data and renders "$0.000".
 */
export function formatCurrency(usd: number | null | undefined): string {
  if (usd == null) return "—";
  return `$${usd.toFixed(usd < 1 ? 3 : 2)}`;
}

/** Compact tokens in→out (e.g. "8.2K→1.3K"); null when either side is missing. */
export function formatCompactTokens(
  tokensIn: number | null | undefined,
  tokensOut: number | null | undefined,
): string | null {
  if (tokensIn == null || tokensOut == null) return null;
  return `${(tokensIn / 1000).toFixed(1)}K→${(tokensOut / 1000).toFixed(1)}K`;
}
