/** Pure helpers for the Compare modal — no I/O, no React. */

/** Formats a cost delta as a signed dollar amount (`"+$0.004"` / `"−$0.010"`),
 *  using a true minus sign for negatives — mirrors `signedDelta`'s sign
 *  convention in `components/eval/helpers.ts`, but for a currency delta (that
 *  helper's `"pt"` percentage-point suffix doesn't apply to cost). `null`
 *  means at least one side's cost wasn't recorded (AC-26 only guarantees a
 *  cost delta when both sides have one). */
export function formatCostDelta(d: number | null): string {
  if (d == null) return "—";
  if (d === 0) return "$0.000";
  const abs = Math.abs(d);
  const amount = abs.toFixed(abs < 1 ? 3 : 2);
  return d > 0 ? `+$${amount}` : `−$${amount}`;
}
