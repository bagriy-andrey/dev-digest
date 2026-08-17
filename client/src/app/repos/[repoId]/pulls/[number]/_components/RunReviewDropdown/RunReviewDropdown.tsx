/* RunReviewDropdown — multi-select agent checklist for kicking off a
   multi-agent review (SPEC-04). Ticking rows never starts anything; the
   primary action starts exactly one HTTP request carrying every checked
   agent id, then lands on the Multi-Agent Review results page.

   The vendored `Dropdown` (`@devdigest/ui`) can't host this: its
   `DropdownItem.onClick` closes the panel unconditionally and
   `DropdownItemDef` has no `checked` field, so every checkbox tick would
   close the panel. `vendor/ui/*` is off-limits beyond `nav.ts`, so this is a
   small local popover instead — the same outside-click pattern
   `vendor/ui/kit/Dropdown.tsx` itself uses. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Checkbox, Icon } from "@devdigest/ui";
import { useAgents } from "@/lib/hooks/agents";
import { useAgentRunEstimates, useStartMultiAgentRun } from "@/lib/hooks/multi-agent";
import { aggregateEstimate, estimateFor, formatCost, formatDuration, hasHistory } from "@/lib/multi-agent-estimates";
import { POPOVER_WIDTH } from "./constants";
import { s } from "./styles";

export function RunReviewDropdown({
  prId,
  size = "sm",
  kind = "primary",
  warnMerged = false,
  onRunStart,
  onRunsStarted,
  onRunSettled,
}: {
  prId: string;
  size?: "sm" | "md" | "lg";
  kind?: "primary" | "secondary";
  /** PR is already merged/closed — dim the trigger and warn, but still allow. */
  warnMerged?: boolean;
  /** Fired the moment a run is kicked off (before it completes). */
  onRunStart?: () => void;
  onRunsStarted?: (runIds: string[]) => void;
  /** Fired when the run request settles (success or error). */
  onRunSettled?: () => void;
}) {
  const t = useTranslations("prReview");
  const router = useRouter();
  const { data: agents } = useAgents();
  const { data: estimates } = useAgentRunEstimates();
  const start = useStartMultiAgentRun();

  const [open, setOpen] = React.useState(false);
  // Local component state only — no store, no context (AC-1).
  const [checked, setChecked] = React.useState<Set<string>>(new Set());

  const wrapperRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [open]);

  const all = agents ?? [];
  const sortedAgents = [...all].sort((a, b) => a.name.localeCompare(b.name));
  const allEstimates = estimates ?? [];

  const toggleAgent = (agentId: string, next: boolean) => {
    setChecked((prev) => {
      const nextSet = new Set(prev);
      if (next) nextSet.add(agentId);
      else nextSet.delete(agentId);
      return nextSet;
    });
  };

  // Derived, never mirrored into extra state.
  const checkedIds = [...checked];
  const canRun = checkedIds.length > 0 && !start.isPending;
  const aggregate = aggregateEstimate(allEstimates, checkedIds);

  const goToConfigureAgents = () => {
    setOpen(false);
    router.push("/multi-agent");
  };

  const handleRun = async () => {
    // Never rely on the disabled attribute alone as the guard (jsdom ignores
    // CSS pointer-events, and a stale click could still fire).
    if (checkedIds.length === 0 || start.isPending) return;
    onRunStart?.();
    try {
      const res = await start.mutateAsync({ prId, agentIds: checkedIds });
      onRunsStarted?.(res.columns.map((c) => c.run_id));
      setOpen(false);
      router.push(`/multi-agent?pr=${prId}`);
    } finally {
      onRunSettled?.();
    }
  };

  return (
    <div ref={wrapperRef} style={s.wrapper}>
      <div onClick={() => setOpen((o) => !o)}>
        <span
          title={warnMerged ? t("runReview.mergedTooltip") : undefined}
          style={warnMerged ? { opacity: 0.6 } : undefined}
        >
          <Button kind={kind} size={size} iconRight="ChevronDown" icon="Sparkles" loading={start.isPending}>
            {start.isPending ? t("runReview.running") : t("runReview.runReview")}
          </Button>
        </span>
      </div>

      {open && (
        <div style={{ ...s.panel, width: POPOVER_WIDTH }}>
          {warnMerged && (
            <>
              <div style={s.warningRow}>
                <Icon.AlertTriangle size={14} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
                <span>{t("runReview.mergedWarning")}</span>
              </div>
              <div style={s.divider} />
            </>
          )}

          {sortedAgents.length === 0 ? (
            <div style={s.emptyRow}>{t("runReview.noAgents")}</div>
          ) : (
            <div style={s.agentList} role="group" aria-label={t("runReview.runReview")}>
              {sortedAgents.map((a) => {
                const est = estimateFor(allEstimates, a.id);
                const estimateLabel = hasHistory(est)
                  ? `${formatDuration(est?.avg_duration_ms ?? null)} · ${formatCost(est?.avg_cost_usd ?? null)}`
                  : "—";
                return (
                  <div key={a.id} style={s.row}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <Checkbox
                        checked={checked.has(a.id)}
                        onChange={(v) => toggleAgent(a.id, v)}
                        label={
                          <span style={s.rowMain}>
                            <Icon.Cpu size={14} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
                            <span style={s.rowName}>{a.name}</span>
                          </span>
                        }
                      />
                    </div>
                    <span style={s.rowEstimate}>{estimateLabel}</span>
                  </div>
                );
              })}
            </div>
          )}

          <div style={s.divider} />
          <button type="button" style={s.configureRow} onClick={goToConfigureAgents}>
            <Icon.Settings size={14} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
            <span>{t("runReview.configureAgents")}</span>
          </button>
          <div style={s.divider} />

          <div style={s.footer}>
            {checkedIds.length > 0 && (
              <div style={s.aggregateLine}>
                {t("runReview.aggregate", {
                  duration: formatDuration(aggregate.durationMs),
                  cost: formatCost(aggregate.costUsd),
                })}
              </div>
            )}
            <Button
              kind="primary"
              size="sm"
              full
              disabled={!canRun}
              loading={start.isPending}
              aria-label={t("runReview.runAction", { count: checkedIds.length })}
              onClick={handleRun}
            >
              {t("runReview.runAction", { count: checkedIds.length })}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
