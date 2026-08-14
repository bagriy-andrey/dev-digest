/* CompareModal — the two-batch comparison view (AC-26/AC-28/AC-29/AC-30).
   Four `old → new` stat deltas, the system-prompt diff (or an explicit
   "version not recorded" note when a side's `agent_version` is null —
   AC-28), the only-in-one-side case counts (AC-29), and a Promote button per
   side ("Promote v<older>" / "Promote v<newer>", AC-30) — the older side
   matters just as much as the newer: the whole point of Compare is often
   "the new prompt regressed, roll back to the old one." Each button is
   independently disabled when its own side has no recorded version. */
"use client";

import { useTranslations } from "next-intl";
import { Modal, Button, Badge, Skeleton, ErrorState, Icon, SectionLabel } from "@devdigest/ui";
import { DeltaChip, formatMetric } from "@/components/eval";
import { useEvalCompare, usePromoteAgentVersion } from "@/lib/hooks";
import { formatCurrency } from "@/lib/format";
import { ApiError } from "@/lib/api";
import { useToast } from "@/lib/toast";
import { formatCostDelta } from "./helpers";
import { s } from "./styles";

export function CompareModal({
  agentId,
  batchA,
  batchB,
  onClose,
}: {
  agentId: string;
  batchA: string;
  batchB: string;
  onClose: () => void;
}) {
  const t = useTranslations("eval");
  const toast = useToast();
  const { data, isLoading, isError, error, refetch } = useEvalCompare(batchA, batchB);
  const promote = usePromoteAgentVersion();

  // AC-28 — the response always orders `a` = older, `b` = newer by ran_at,
  // regardless of the order the two batch ids were passed in.
  const olderVersion = data?.a.agent_version ?? null;
  const newerVersion = data?.b.agent_version ?? null;
  const promoteOlderDisabled = olderVersion == null || promote.isPending;
  const promoteNewerDisabled = newerVersion == null || promote.isPending;

  const promoteVersion = (version: number) => {
    promote.mutate(
      { agentId, version },
      {
        onSuccess: () => {
          toast.success(t("compare.promote", { version }));
          onClose();
        },
        onError: (err) =>
          toast.error(err instanceof ApiError ? err.message : t("compare.promoteDisabled")),
      },
    );
  };
  const handlePromoteOlder = () => {
    if (olderVersion != null) promoteVersion(olderVersion);
  };
  const handlePromoteNewer = () => {
    if (newerVersion != null) promoteVersion(newerVersion);
  };

  return (
    <Modal title={t("compare.title")} onClose={onClose} width={760}>
      {isLoading || !data ? (
        <div style={s.body}>
          <Skeleton height={20} width={200} />
          <Skeleton height={80} />
          <Skeleton height={160} />
        </div>
      ) : isError ? (
        <div style={s.body}>
          <ErrorState
            body={error instanceof ApiError ? error.message : undefined}
            onRetry={() => refetch()}
          />
        </div>
      ) : (
        <div style={s.body}>
          <div style={s.sideHeads}>
            <span>
              <Badge mono>{t("compare.older")}</Badge>{" "}
              <span className="tnum">
                {data.a.agent_version != null ? `v${data.a.agent_version}` : "—"} ·{" "}
                {new Date(data.a.ran_at).toLocaleString()}
              </span>
            </span>
            <span>
              <Badge mono>{t("compare.newer")}</Badge>{" "}
              <span className="tnum">
                {data.b.agent_version != null ? `v${data.b.agent_version}` : "—"} ·{" "}
                {new Date(data.b.ran_at).toLocaleString()}
              </span>
            </span>
          </div>

          <div style={s.deltaGrid}>
            <StatDelta
              label={t("dashboard.metrics.recall")}
              older={formatMetric(data.a.recall, data.a.recall_na)}
              newer={formatMetric(data.b.recall, data.b.recall_na)}
              delta={data.delta.recall}
            />
            <StatDelta
              label={t("dashboard.metrics.precision")}
              older={formatMetric(data.a.precision, data.a.precision_na)}
              newer={formatMetric(data.b.precision, data.b.precision_na)}
              delta={data.delta.precision}
            />
            <StatDelta
              label={t("dashboard.metrics.citationAccuracy")}
              older={formatMetric(data.a.citation_accuracy, data.a.citation_accuracy_na)}
              newer={formatMetric(data.b.citation_accuracy, data.b.citation_accuracy_na)}
              delta={data.delta.citation_accuracy}
            />
            <CostDelta
              label={t("dashboard.table.cost")}
              older={data.a.cost_usd}
              newer={data.b.cost_usd}
              delta={data.delta.cost_usd}
            />
          </div>

          {(data.cases_only_in_a > 0 || data.cases_only_in_b > 0) && (
            <div style={s.caseSetNote}>
              {data.cases_only_in_a > 0 && (
                <p style={{ margin: 0 }}>{t("compare.caseSetDiffers", { count: data.cases_only_in_a })}</p>
              )}
              {data.cases_only_in_b > 0 && (
                <p style={{ margin: 0 }}>{t("compare.caseSetDiffers", { count: data.cases_only_in_b })}</p>
              )}
            </div>
          )}

          <div style={s.promptGrid}>
            <div>
              <SectionLabel>
                {t("compare.systemPrompt")} · {t("compare.older")}
              </SectionLabel>
              {data.system_prompt_a != null ? (
                <pre style={s.promptBox}>{data.system_prompt_a}</pre>
              ) : (
                <p style={s.versionNote}>{t("compare.versionNotRecorded")}</p>
              )}
            </div>
            <div>
              <SectionLabel>
                {t("compare.systemPrompt")} · {t("compare.newer")}
              </SectionLabel>
              {data.system_prompt_b != null ? (
                <pre style={s.promptBox}>{data.system_prompt_b}</pre>
              ) : (
                <p style={s.versionNote}>{t("compare.versionNotRecorded")}</p>
              )}
            </div>
          </div>

          <div style={s.promoteBar}>
            <Button
              kind="secondary"
              disabled={promoteOlderDisabled}
              loading={promote.isPending}
              title={olderVersion == null ? t("compare.promoteDisabled") : undefined}
              aria-describedby={olderVersion == null ? "promote-older-disabled-reason" : undefined}
              onClick={handlePromoteOlder}
            >
              {t("compare.promote", { version: olderVersion ?? "—" })}
            </Button>
            <Button
              kind="primary"
              disabled={promoteNewerDisabled}
              loading={promote.isPending}
              title={newerVersion == null ? t("compare.promoteDisabled") : undefined}
              aria-describedby={newerVersion == null ? "promote-newer-disabled-reason" : undefined}
              onClick={handlePromoteNewer}
            >
              {t("compare.promote", { version: newerVersion ?? "—" })}
            </Button>
            {olderVersion == null && (
              <span id="promote-older-disabled-reason" style={s.disabledReason}>
                {t("compare.promoteDisabled")}
              </span>
            )}
            {newerVersion == null && (
              <span id="promote-newer-disabled-reason" style={s.disabledReason}>
                {t("compare.promoteDisabled")}
              </span>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

function StatDelta({
  label,
  older,
  newer,
  delta,
}: {
  label: string;
  older: string;
  newer: string;
  delta: number;
}) {
  return (
    <div style={s.statCard}>
      <div style={s.statLabel}>{label}</div>
      <div style={s.statValues}>
        <span className="tnum">{older}</span>
        <Icon.ArrowRight size={12} style={{ color: "var(--text-muted)" }} aria-hidden="true" />
        <span className="tnum">{newer}</span>
      </div>
      <DeltaChip delta={delta} />
    </div>
  );
}

/** Cost isn't a metric fraction (`signedDelta`'s `"pt"` suffix doesn't apply),
 *  so it gets its own icon+text chip — same non-colour-alone contract as
 *  `DeltaChip`, dollar-formatted instead of percentage-point-formatted. */
function CostDelta({
  label,
  older,
  newer,
  delta,
}: {
  label: string;
  older: number | null;
  newer: number | null;
  delta: number | null;
}) {
  const flat = delta == null || delta === 0;
  const up = (delta ?? 0) > 0;
  const color = flat ? "var(--text-muted)" : up ? "var(--ok)" : "var(--crit)";
  const DirectionIcon = flat ? Icon.Slash : up ? Icon.ArrowUp : Icon.ArrowDown;
  return (
    <div style={s.statCard}>
      <div style={s.statLabel}>{label}</div>
      <div style={s.statValues}>
        <span className="tnum">{formatCurrency(older)}</span>
        <Icon.ArrowRight size={12} style={{ color: "var(--text-muted)" }} aria-hidden="true" />
        <span className="tnum">{formatCurrency(newer)}</span>
      </div>
      <span style={s.chip(color)}>
        <DirectionIcon size={12} aria-hidden="true" />
        <span className="tnum">{formatCostDelta(delta)}</span>
      </span>
    </div>
  );
}
