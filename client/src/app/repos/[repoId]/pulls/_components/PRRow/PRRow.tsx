/* PRRow — one clickable row in the PR list table. Ported from screen_dashboard.jsx. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Icon, Avatar, Badge, CircularScore, SeverityBadge, CategoryTag, ConfidenceNum, type Severity, type Category } from "@devdigest/ui";
import { RunCostBadge } from "@/components/RunCostBadge";
import type { PrMeta } from "@/lib/types";
import { SIZE_COLOR, STATUS_META } from "../../constants";
import { relativeTime, sizeOf } from "../../helpers";
import { s } from "../../styles";

export function PRRow({ pr, repoId }: { pr: PrMeta; repoId: string }) {
  const t = useTranslations("prReview");
  const router = useRouter();
  const [h, setH] = React.useState(false);
  const cellRef = React.useRef<HTMLDivElement>(null);
  const [tip, setTip] = React.useState<{ top: number; left: number } | null>(null);
  const onFindingsEnter = React.useCallback(() => {
    if (!pr.findings?.length) return;
    const r = cellRef.current?.getBoundingClientRect();
    if (r) setTip({ top: r.bottom + 6, left: r.left });
  }, [pr.findings]);
  const onFindingsLeave = React.useCallback(() => setTip(null), []);
  const st = STATUS_META[pr.status] ?? STATUS_META.needs_review!;
  const { size, lines } = sizeOf(pr);
  const reviewed = pr.score != null; // null score ⇒ PR has never been reviewed
  return (
    <div
      onMouseEnter={() => setH(true)}
      onMouseLeave={() => setH(false)}
      onClick={() => router.push(`/repos/${repoId}/pulls/${pr.number}`)}
      style={s.row(h)}
    >
      <div style={s.rowTitleCell}>
        <Icon.GitPullRequest size={15} style={s.rowIcon(st.c)} />
        <div style={s.rowTitleWrap}>
          <div style={s.rowTitle(h)}>{pr.title}</div>
          <span className="mono" style={s.rowNumber}>
            #{pr.number}
          </span>
        </div>
      </div>
      <div style={s.authorCell}>
        <Avatar name={pr.author} size={18} />
        {pr.author}
      </div>
      <div>
        <Badge
          color={SIZE_COLOR[size]}
          bg="transparent"
          style={s.sizeBadgeBorder(SIZE_COLOR[size]!)}
        >
          {size} · {lines}
        </Badge>
      </div>
      <div style={s.scoreCell}>
        {reviewed ? (
          <CircularScore score={pr.score!} size={34} stroke={3} />
        ) : (
          <span style={s.muted}>—</span>
        )}
      </div>
      <div
        ref={cellRef}
        style={s.findingsCell}
        onMouseEnter={onFindingsEnter}
        onMouseLeave={onFindingsLeave}
      >
        {pr.findings_by_severity
          ? (["CRITICAL", "WARNING", "SUGGESTION"] as Severity[]).map((sev) => {
              const count = pr.findings_by_severity![sev];
              if (!count) return null;
              return <SeverityBadge key={sev} severity={sev} count={count} compact />;
            })
          : <span style={s.muted}>—</span>}
        {tip && (
          <div style={{
            position: "fixed", top: tip.top, left: tip.left,
            zIndex: 9999, width: 310, maxHeight: 360, overflow: "hidden",
            background: "var(--bg-elevated)", border: "1px solid var(--border-strong)",
            borderRadius: 10, boxShadow: "0 8px 32px rgba(0,0,0,0.35)",
            pointerEvents: "none",
          }}>
            <div style={{ padding: "8px 14px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 7, fontSize: 11, fontWeight: 700, letterSpacing: "0.07em", color: "var(--text-muted)", textTransform: "uppercase" }}>
              <Icon.Dot size={12} />
              {pr.findings!.length} {t("list.columns.findings")}
            </div>
            {pr.findings!.map((f, i) => (
              <div key={f.id} style={{ padding: "10px 14px", borderBottom: i < pr.findings!.length - 1 ? "1px solid var(--border)" : "none" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 4 }}>
                  <SeverityBadge severity={f.severity as Severity} compact />
                  <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.title}</span>
                  <CategoryTag category={f.category as Category} />
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                  <span className="mono" style={{ fontSize: 11.5, color: "var(--accent-text)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {f.file}:{f.start_line === f.end_line ? f.start_line : `${f.start_line}-${f.end_line}`}
                  </span>
                  <ConfidenceNum value={f.confidence} />
                </div>
                <div style={{ fontSize: 12, color: "var(--text-secondary)", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                  {f.rationale}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <div>
        <Badge dot color={st.c} bg="transparent">
          {t(`list.status.${st.labelKey}`)}
        </Badge>
      </div>
      <div style={s.costCell}>
        <RunCostBadge usd={pr.cost_usd} />
      </div>
      <div style={s.updatedCell}>{relativeTime(pr.updated_at)}</div>
    </div>
  );
}
