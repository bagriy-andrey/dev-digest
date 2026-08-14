/* DeltaChip — up/down/flat indicator for a metric delta. Accessibility: the
   direction is carried by an explicit icon AND a signed text label (never by
   colour alone) — the same class of fix already applied to risk chips
   elsewhere in this codebase (`client/insights.md`). */
import { Icon } from "@devdigest/ui";
import { signedDelta } from "./helpers";
import { s } from "./styles";

export function DeltaChip({ delta }: { delta: number }) {
  const flat = delta === 0;
  const up = delta > 0;
  const color = flat ? "var(--text-muted)" : up ? "var(--ok)" : "var(--crit)";
  const DirectionIcon = flat ? Icon.Slash : up ? Icon.ArrowUp : Icon.ArrowDown;

  return (
    <span style={s.chip(color)}>
      <DirectionIcon size={12} aria-hidden="true" />
      <span className="tnum">{signedDelta(delta)}</span>
    </span>
  );
}
