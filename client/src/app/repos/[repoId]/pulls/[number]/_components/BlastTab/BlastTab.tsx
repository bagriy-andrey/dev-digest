/* BlastTab — full Blast Radius view (dedicated PR-detail tab): Tree (default)
   or Graph, untruncated caller/endpoint/cron lists. Same usePrBlast(prId)
   data source as BlastRadiusCard — TanStack Query cache is shared, no double
   fetch. Reads only (GET /pulls/:id/blast) — zero LLM calls. */
"use client";

import React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { SectionLabel, Button, EmptyState, MonoLink, Icon, Badge, Skeleton } from "@devdigest/ui";
import { usePrBlast, useSummarizeBlast } from "@/lib/hooks";
import { computeBlastStats } from "@/lib/blast-stats";
import { BlastGraph } from "./_components/BlastGraph";
import { s } from "./styles";

interface BlastTabProps {
  prId: string | null;
  repoId: string;
  onOpenInDiff: (file: string, line: number | null) => void;
}

export function BlastTab({ prId, repoId, onOpenInDiff }: BlastTabProps) {
  const t = useTranslations("prReview");
  const { data: blast, isLoading } = usePrBlast(prId);
  const summarize = useSummarizeBlast(prId);
  const [view, setView] = React.useState<"tree" | "graph">("tree");
  const [priorOpen, setPriorOpen] = React.useState(false);

  if (isLoading) {
    return (
      <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <Skeleton height={28} width={220} />
        <Skeleton height={160} />
      </section>
    );
  }

  if (!blast || blast.changed_symbols.length === 0) {
    return <EmptyState icon="Zap" title={t("blast.label")} body={t("blast.empty")} />;
  }

  const stats = computeBlastStats(blast);

  return (
    <section>
      <SectionLabel
        icon="Zap"
        right={
          <div style={s.toggleGroup}>
            <Button
              kind="ghost"
              size="sm"
              icon="Sparkles"
              loading={summarize.isPending}
              onClick={() => summarize.mutate()}
            >
              {summarize.isPending ? t("blast.summarizing") : t("blast.summarize")}
            </Button>
            <Button kind={view === "tree" ? "secondary" : "ghost"} size="sm" onClick={() => setView("tree")}>
              {t("blast.tree")}
            </Button>
            <Button kind={view === "graph" ? "secondary" : "ghost"} size="sm" onClick={() => setView("graph")}>
              {t("blast.graph")}
            </Button>
          </div>
        }
      >
        {t("blast.label")}
      </SectionLabel>

      <div style={s.statsLine}>
        {t("blast.statsSymbols", { count: stats.symbols })} ·{" "}
        {t("blast.statsCallers", { count: stats.callers })} ·{" "}
        {t("blast.statsEndpoints", { count: stats.endpoints })} ·{" "}
        {t("blast.statsCrons", { count: stats.crons })}
      </div>

      {blast.degraded && (
        <div style={s.degradedBadge}>
          <Icon.AlertTriangle size={13} />
          {t("blast.degradedBadge", { reason: blast.degraded_reason ?? "unknown" })}
        </div>
      )}

      {blast.summary && <p style={s.summaryText}>{blast.summary}</p>}
      {summarize.isError && <div style={s.error}>{t("blast.summarizeError")}</div>}

      {view === "tree" ? (
        <div style={s.symbolList}>
          {blast.downstream.map((d) => (
            <div key={d.symbol} style={s.symbolBlock}>
              <div style={s.symbolTitleRow}>
                <span className="mono" style={s.symbolName}>
                  {d.symbol}()
                </span>
              </div>

              <div style={s.sectionLabel}>{t("blast.callers")}</div>
              {d.callers.length === 0 ? (
                <div style={s.empty}>{t("blast.noCallers")}</div>
              ) : (
                <ul style={s.callerList}>
                  {d.callers.map((c, i) => (
                    <li key={`${c.file}:${c.line}:${i}`}>
                      <MonoLink onClick={() => onOpenInDiff(c.file, c.line)}>
                        {c.file}:{c.line}
                      </MonoLink>
                    </li>
                  ))}
                </ul>
              )}

              {(d.endpoints_affected.length > 0 || d.crons_affected.length > 0) && (
                <>
                  <div style={s.sectionLabel}>{t("blast.endpoints")}</div>
                  <div style={s.chipRow}>
                    {d.endpoints_affected.map((e) => (
                      <Badge key={e} mono>
                        {e}
                      </Badge>
                    ))}
                    {d.crons_affected.map((c) => (
                      <Badge key={c} icon="Clock" mono>
                        {c}
                      </Badge>
                    ))}
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div style={s.graphWrap}>
          <BlastGraph downstream={blast.downstream} onOpenInDiff={onOpenInDiff} />
        </div>
      )}

      {blast.prior_prs.length > 0 && (
        <div style={s.priorSection}>
          <button type="button" onClick={() => setPriorOpen(!priorOpen)} style={s.priorHeader}>
            <Icon.ChevronDown size={14} style={s.chevron(priorOpen)} />
            <Icon.Clock size={14} />
            <span>{t("blast.priorPrs")}</span>
            <Badge>{blast.prior_prs.length}</Badge>
          </button>

          {priorOpen && (
            <ul style={s.priorList}>
              {blast.prior_prs.map((pr) => (
                <li key={pr.id}>
                  <Link href={`/repos/${repoId}/pulls/${pr.number}`} style={s.priorLink}>
                    #{pr.number} {pr.title}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
