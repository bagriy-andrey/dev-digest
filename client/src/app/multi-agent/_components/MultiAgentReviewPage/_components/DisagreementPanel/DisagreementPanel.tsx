/* DisagreementPanel — "Where agents disagree" (AC-30, AC-32, AC-44). Renders
   the server's widened conflicts[] set (AC-46: full-agreement groups
   included by default); "Show only conflicts" filters through the pure
   `isDivergent` helper. An 'ignored' take renders a localized "did not
   flag" label derived from the verdict itself, never from `note` (AC-32).
   Untrusted content (title/persona/note) is rendered as plain text. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Card, EmptyState, SeverityBadge, Toggle } from "@devdigest/ui";
import type { Conflict } from "@/lib/types";
import { isDivergent } from "../../helpers";
import { s } from "./styles";

export function DisagreementPanel({ conflicts }: { conflicts: Conflict[] }) {
  const t = useTranslations("multiAgent");
  const [showOnlyConflicts, setShowOnlyConflicts] = React.useState(false);

  if (conflicts.length === 0) {
    return (
      <Card>
        <div style={s.title}>{t("conflicts.title")}</div>
        <EmptyState icon="GitMerge" title={t("conflicts.empty")} />
      </Card>
    );
  }

  const visible = showOnlyConflicts ? conflicts.filter(isDivergent) : conflicts;

  return (
    <Card>
      <div style={s.head}>
        <span style={s.title}>{t("conflicts.title")}</span>
        <div style={s.toggleRow}>
          <span id="disagreement-toggle-label" style={s.toggleLabel}>
            {t("conflicts.showOnlyConflicts")}
          </span>
          <Toggle on={showOnlyConflicts} onChange={setShowOnlyConflicts} size={16} />
        </div>
      </div>

      {visible.length === 0 ? (
        <div style={s.filteredEmpty}>{t("conflicts.empty")}</div>
      ) : (
        visible.map((conflict) => (
          <div key={`${conflict.file}:${conflict.line}`} style={s.group}>
            <div style={s.groupHead}>
              <span style={s.location}>
                {conflict.file}:{conflict.line}
              </span>
              <span style={s.groupTitle}>{conflict.title}</span>
            </div>
            <div style={s.takes}>
              {conflict.takes.map((take) => (
                <div key={take.agent_id} style={s.take}>
                  <span style={s.persona}>{take.persona}</span>
                  {take.verdict === "ignored" ? (
                    <span style={s.ignored}>{t("conflicts.didNotFlag")}</span>
                  ) : (
                    <>
                      <SeverityBadge severity={take.verdict} compact />
                      {take.note && <span style={s.note}>{take.note}</span>}
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))
      )}
    </Card>
  );
}
