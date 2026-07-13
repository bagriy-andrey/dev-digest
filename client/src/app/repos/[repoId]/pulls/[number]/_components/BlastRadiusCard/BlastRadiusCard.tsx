/* BlastRadiusCard — compact PR impact-map preview on the Overview tab. Reads
   the blast radius (never computes it — GET /pulls/:id/blast is pure reads
   over the repo-intel index, zero LLM calls). Tree-only; the full Tree/Graph
   view lives in the dedicated Blast tab (see BlastTab). */
"use client";

import React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { SectionLabel, Badge, Button, MonoLink, Icon } from "@devdigest/ui";
import { usePrBlast, useSummarizeBlast } from "@/lib/hooks";
import { computeBlastStats } from "@/lib/blast-stats";
import { MAX_CARD_CALLERS, MAX_CARD_ENDPOINTS } from "./constants";
import { s } from "./styles";

interface BlastRadiusCardProps {
  prId: string | null;
  repoId: string;
  onOpenInDiff: (file: string, line: number | null) => void;
}

export function BlastRadiusCard({ prId, repoId, onOpenInDiff }: BlastRadiusCardProps) {
  const t = useTranslations("prReview");
  const { data: blast, isLoading } = usePrBlast(prId);
  const summarize = useSummarizeBlast(prId);
  const [expandedSymbol, setExpandedSymbol] = React.useState<string | null>(null);
  const [priorOpen, setPriorOpen] = React.useState(false);
  const stats = blast ? computeBlastStats(blast) : null;

  return (
    <section>
      <SectionLabel
        icon="Zap"
        right={
          <div style={s.headerActions}>
            {blast && blast.changed_symbols.length > 0 && (
              <Button
                kind="ghost"
                size="sm"
                icon="Sparkles"
                loading={summarize.isPending}
                disabled={!prId}
                onClick={() => summarize.mutate()}
              >
                {summarize.isPending ? t("blast.summarizing") : t("blast.summarize")}
              </Button>
            )}
            <Link href="?tab=blast" style={s.seeFullMapLink}>
              {t("blast.seeFullMap")}
            </Link>
          </div>
        }
      >
        {t("blast.label")}
      </SectionLabel>

      <div style={s.card}>
        {isLoading ? (
          <div style={s.empty}>{t("blast.loading")}</div>
        ) : !blast || blast.changed_symbols.length === 0 ? (
          <div style={s.empty}>{t("blast.empty")}</div>
        ) : (
          <>
            {blast.degraded && (
              <div style={s.degradedBadge}>
                <Icon.AlertTriangle size={13} />
                {t("blast.degradedBadge", { reason: blast.degraded_reason ?? "unknown" })}
              </div>
            )}
            {blast.summary && <p style={s.summaryText}>{blast.summary}</p>}
            {summarize.isError && <div style={s.error}>{t("blast.summarizeError")}</div>}
            {stats && (
              <div style={s.statsLine}>
                <span style={s.statItem}>
                  <Icon.Code size={13} />
                  {t("blast.statsSymbols", { count: stats.symbols })}
                </span>
                <span style={s.statItem}>
                  <Icon.CornerDownRight size={13} />
                  {t("blast.statsCallers", { count: stats.callers })}
                </span>
                <span style={s.statItem}>
                  <Icon.Globe size={13} />
                  {t("blast.statsEndpoints", { count: stats.endpoints })}
                </span>
                <span style={s.statItem}>
                  <Icon.Clock size={13} />
                  {t("blast.statsCrons", { count: stats.crons })}
                </span>
              </div>
            )}
            <div style={s.symbolList}>
              {blast.downstream.map((d) => {
                const expanded = expandedSymbol === d.symbol;
                const impactCount = d.endpoints_affected.length + d.crons_affected.length;
                return (
                  <div key={d.symbol} style={s.symbolRow}>
                    <button
                      type="button"
                      onClick={() => setExpandedSymbol(expanded ? null : d.symbol)}
                      style={s.symbolHeader}
                    >
                      <Icon.ChevronDown size={14} style={s.chevron(expanded)} />
                      <span className="mono" style={s.symbolName}>
                        <Icon.Code size={13} style={s.symbolIcon} />
                        {d.symbol}()
                      </span>
                      <span style={s.countTag}>{t("blast.callersCount", { count: d.callers.length })}</span>
                      {impactCount > 0 && (
                        <span style={s.countTag}>{t("blast.impactsCount", { count: impactCount })}</span>
                      )}
                    </button>

                    {expanded && (
                      <div style={s.symbolBody}>
                        {d.callers.length === 0 ? (
                          <div style={s.empty}>{t("blast.noCallers")}</div>
                        ) : (
                          <>
                            <ul style={s.callerList}>
                              {d.callers.slice(0, MAX_CARD_CALLERS).map((c, i) => (
                                <li key={`${c.file}:${c.line}:${i}`} style={s.callerLine}>
                                  <Icon.CornerDownRight size={12} style={s.callerIcon} />
                                  <MonoLink onClick={() => onOpenInDiff(c.file, c.line)}>
                                    {c.file}:{c.line}
                                  </MonoLink>
                                </li>
                              ))}
                            </ul>
                            {d.callers.length > MAX_CARD_CALLERS && (
                              <Link href="?tab=blast" style={s.showMore}>
                                {t("blast.showMoreCallers", { count: d.callers.length - MAX_CARD_CALLERS })}
                              </Link>
                            )}
                          </>
                        )}
                        {impactCount > 0 && (
                          <div style={s.chipRow}>
                            {d.endpoints_affected.slice(0, MAX_CARD_ENDPOINTS).map((e) => (
                              <Badge key={e} bg="var(--accent-bg, var(--bg-hover))" color="var(--accent-text)" mono>
                                {e}
                              </Badge>
                            ))}
                            {d.endpoints_affected.length <= MAX_CARD_ENDPOINTS &&
                              d.crons_affected.map((c) => (
                                <Badge key={c} icon="Clock" mono>
                                  {c}
                                </Badge>
                              ))}
                            {d.endpoints_affected.length > MAX_CARD_ENDPOINTS && (
                              <Link href="?tab=blast" style={s.showMore}>
                                {t("blast.showMoreEndpoints", {
                                  count: d.endpoints_affected.length - MAX_CARD_ENDPOINTS + d.crons_affected.length,
                                })}
                              </Link>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            {blast.prior_prs.length > 0 && (
              <div style={s.priorSection}>
                <button
                  type="button"
                  onClick={() => setPriorOpen(!priorOpen)}
                  style={s.priorHeader}
                >
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
          </>
        )}
      </div>
    </section>
  );
}
