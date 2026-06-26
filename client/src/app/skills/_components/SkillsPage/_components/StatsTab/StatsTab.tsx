"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { MetricCard, Donut, type DonutSegment } from "@devdigest/ui";
import { useSkillStats } from "@/lib/hooks/skills";
import { CATEGORY_COLORS, DEFAULT_CATEGORY_COLOR } from "../../constants";
import { s } from "../../styles";

export function StatsTab({ skillId }: { skillId: string }) {
  const { data, isLoading } = useSkillStats(skillId);
  const router = useRouter();

  if (isLoading || !data) {
    return <div style={{ padding: 20, color: "var(--text-muted)", fontSize: 13 }}>Loading stats…</div>;
  }

  const segments: DonutSegment[] = data.findingsByCategory.map((c) => ({
    label: c.category,
    value: c.count,
    color: CATEGORY_COLORS[c.category] ?? DEFAULT_CATEGORY_COLOR,
  }));

  return (
    <div>
      <div style={s.metricsRow}>
        <MetricCard label="USED BY" value={`${data.agentsCount}`} suffix=" agents" />
        <MetricCard label="PULL FREQUENCY" value={`${data.pullFrequencyPct}`} suffix="%" />
        <MetricCard label="ACCEPT RATE" value={`${data.acceptRatePct}`} suffix="%" color="var(--ok)" />
        <MetricCard label="FINDINGS (30D)" value={`${data.findings30d}`} />
      </div>

      <div style={s.statsGrid}>
        <div style={s.statsSection}>
          <div style={s.statsSectionLabel}>AGENTS USING THIS SKILL</div>
          {data.agentsUsing.length === 0 ? (
            <div style={{ fontSize: 13, color: "var(--text-muted)" }}>No agents linked.</div>
          ) : (
            data.agentsUsing.map((a) => (
              <div key={a.id} style={s.agentRow}>
                <span style={{ flex: 1 }}>{a.name}</span>
                <button
                  onClick={() => router.push(`/agents/${a.id}`)}
                  style={{
                    background: "none",
                    border: "none",
                    color: "var(--accent-text)",
                    cursor: "pointer",
                    fontSize: 12,
                    fontWeight: 600,
                  }}
                >
                  Open
                </button>
              </div>
            ))
          )}
        </div>

        <div style={s.statsSection}>
          <div style={s.statsSectionLabel}>FINDINGS BY CATEGORY</div>
          {segments.length === 0 ? (
            <div style={{ fontSize: 13, color: "var(--text-muted)" }}>No findings yet.</div>
          ) : (
            <Donut segments={segments} valuePrefix="" />
          )}
        </div>
      </div>
    </div>
  );
}
