/* FindingCard — ported from findings.jsx (createElement → TSX).
   Severity icon+label, category, file:line, confidence, markdown rationale +
   suggestion, accept/dismiss actions. Accept/dismiss reflect persisted
   timestamps. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import {
  Icon,
  SeverityBadge,
  CategoryTag,
  MonoLink,
  ConfidenceNum,
  Button,
  Markdown,
  type Severity,
  type Category,
} from "@devdigest/ui";
import type { FindingRecord, FindingActionKind } from "@devdigest/shared";
import { useCreateEvalCaseFromFinding } from "@/lib/hooks/evals";
import { notify } from "@/lib/toast";
import { SEV_COLOR, SEV_COLOR_FALLBACK } from "./constants";
import { lineLabel } from "./helpers";
import { s } from "./styles";

/* Split into its own child component (rather than calling the mutation hook
   unconditionally at the top of FindingCard) so the hook — and the
   QueryClientProvider it requires — is only ever instantiated for a DECIDED
   finding, i.e. exactly when this action can render (AC-1/AC-2). An undecided
   finding's FindingCard never mounts this component, so callers that render
   FindingCard with only undecided fixtures (e.g. FindingsPanel's tests) don't
   need a QueryClientProvider or a mock for this hook. */
function TurnIntoEvalCaseAction({ findingId }: { findingId: string }) {
  const t = useTranslations("prReview");
  const createEvalCase = useCreateEvalCaseFromFinding();
  return (
    <Button
      kind="ghost"
      size="sm"
      icon="FlaskConical"
      disabled={createEvalCase.isPending}
      loading={createEvalCase.isPending}
      onClick={() =>
        createEvalCase.mutate(findingId, {
          onSuccess: () => notify.success(t("finding.evalCaseCreated")),
        })
      }
    >
      {t("finding.turnIntoEvalCase")}
    </Button>
  );
}

export function FindingCard({
  f,
  focused,
  defaultExpanded,
  onAction,
  pending,
  onOpenInDiff,
}: {
  f: FindingRecord;
  focused?: boolean;
  defaultExpanded?: boolean;
  onAction?: (action: FindingActionKind, reply?: string) => void;
  pending?: boolean;
  /** file:line click → open + scroll to it in the Files changed tab, instead
   *  of leaving the app for GitHub. */
  onOpenInDiff?: (file: string, line: number | null) => void;
}) {
  const t = useTranslations("prReview");
  const [expanded, setExpanded] = React.useState(defaultExpanded ?? false);
  const sevColor = SEV_COLOR[f.severity] ?? SEV_COLOR_FALLBACK;
  const accepted = !!f.accepted_at;
  const dismissed = !!f.dismissed_at;
  const muted = accepted || dismissed;

  return (
    <div data-finding-id={f.id} style={s.card(!!focused, sevColor, muted)}>
      <div onClick={() => setExpanded((e) => !e)} style={s.header}>
        <div style={s.badgeWrap}>
          <SeverityBadge severity={f.severity as Severity} compact />
        </div>
        <div style={s.headerMain}>
          <div style={s.titleRow}>
            <span style={s.title(muted, dismissed)}>{f.title}</span>
            <CategoryTag category={f.category as Category} />
            {accepted && <span style={s.acceptedTag}>{t("finding.accepted")}</span>}
            {dismissed && <span style={s.dismissedTag}>{t("finding.dismissed")}</span>}
          </div>
          <div style={s.metaRow}>
            {/* MonoLink's button mode doesn't stop propagation itself (unlike its
                anchor mode) — without this wrapper, the click also bubbles to the
                header's expand/collapse toggle. */}
            <span onClick={(e) => e.stopPropagation()}>
              <MonoLink
                onClick={
                  onOpenInDiff ? () => onOpenInDiff(f.file, f.start_line ?? f.end_line ?? null) : undefined
                }
              >
                {f.file}:{lineLabel(f)}
              </MonoLink>
            </span>
            <ConfidenceNum value={f.confidence} />
          </div>
        </div>
        <Icon.ChevronDown size={16} style={s.chevron(expanded)} />
      </div>

      {expanded && (
        <div style={s.body}>
          <div style={s.prose}>
            <Markdown>{f.rationale}</Markdown>
          </div>
          {f.suggestion && (
            <div style={s.suggestionWrap}>
              <div style={s.suggestionLabel}>{t("finding.suggestedFix")}</div>
              <div style={s.prose}>
                <Markdown>{f.suggestion}</Markdown>
              </div>
            </div>
          )}

          <div style={s.actions}>
            <Button
              kind="secondary"
              size="sm"
              icon="Check"
              disabled={pending}
              active={accepted}
              onClick={() => onAction?.("accept")}
            >
              {t("finding.accept")}
            </Button>
            <Button
              kind="ghost"
              size="sm"
              icon="X"
              disabled={pending}
              active={dismissed}
              onClick={() => onAction?.("dismiss")}
            >
              {t("finding.dismiss")}
            </Button>
            {muted && <TurnIntoEvalCaseAction findingId={f.id} />}
          </div>
        </div>
      )}
    </div>
  );
}
