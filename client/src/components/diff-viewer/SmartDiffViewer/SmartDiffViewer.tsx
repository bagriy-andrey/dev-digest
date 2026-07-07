/* SmartDiffViewer — groups a PR's changed files by review risk (core → wiring
   → boilerplate) so a reviewer's eye lands on business logic first. Reuses
   FileCard/CodeLine for actual file rendering; this component only groups,
   collapses, and overlays the findings badge. Purely a client-side view over
   the already-composed `SmartDiff` payload — no data fetching here. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import type { PrFile, SmartDiff } from "@/lib/types";
import type { DiffCommentApi } from "../comments";
import { s as diffStyles } from "../styles";
import { FileCard } from "../FileCard";
import { s, chevronForSection } from "./styles";

const ROLE_ORDER = ["core", "wiring", "boilerplate"] as const;

export function SmartDiffViewer({
  smartDiff,
  files,
  commenting,
  targetFile,
  targetLine,
  targetNonce,
}: {
  smartDiff: SmartDiff;
  files: PrFile[];
  commenting?: DiffCommentApi;
  /** External navigation target (e.g. from a finding's file:line link) —
   *  forces open the containing role section, then the FileCard/line. */
  targetFile?: string | null;
  targetLine?: number | null;
  targetNonce?: number;
}) {
  const t = useTranslations("shell");
  const fileByPath = React.useMemo(() => {
    const map = new Map<string, PrFile>();
    for (const f of files) map.set(f.path, f);
    return map;
  }, [files]);

  const [collapsed, setCollapsed] = React.useState<Record<string, boolean>>({
    core: false,
    wiring: false,
    boilerplate: true,
  });

  const groupByRole = React.useMemo(() => {
    const map = new Map<string, SmartDiff["groups"][number]>();
    for (const g of smartDiff.groups) map.set(g.role, g);
    return map;
  }, [smartDiff]);

  // A target file may live in a section that's collapsed by default
  // (boilerplate) — expand it before the FileCard below tries to scroll.
  React.useEffect(() => {
    if (!targetFile) return;
    for (const role of ROLE_ORDER) {
      if (groupByRole.get(role)?.files.some((f) => f.path === targetFile)) {
        setCollapsed((c) => (c[role] ? { ...c, [role]: false } : c));
        break;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetFile, targetNonce, groupByRole]);

  if (files.length === 0) {
    return <div style={diffStyles.empty}>{t("diffViewer.noChangedFiles")}</div>;
  }

  return (
    <div style={diffStyles.list}>
      {smartDiff.split_suggestion.too_big && (
        <div style={s.splitBanner}>
          <Icon.AlertTriangle size={14} />
          <span>
            {t("diffViewer.smart.splitTooBig", {
              total: smartDiff.split_suggestion.total_lines,
            })}{" "}
            {smartDiff.split_suggestion.proposed_splits.map((p) => p.name).join(", ")}
          </span>
        </div>
      )}
      {ROLE_ORDER.map((role) => {
        const group = groupByRole.get(role);
        if (!group || group.files.length === 0) return null;
        const isCollapsed = collapsed[role];
        return (
          <div key={role} style={s.section}>
            <div
              style={s.sectionHeader}
              onClick={() => setCollapsed((c) => ({ ...c, [role]: !c[role] }))}
            >
              <Icon.ChevronRight size={13} style={chevronForSection(!isCollapsed)} />
              <span style={s.sectionRole}>{t(`diffViewer.smart.role.${role}`)}</span>
              <span style={s.sectionDescription}>
                {t(`diffViewer.smart.roleDescription.${role}`)}
              </span>
              <span style={s.sectionCount}>
                {t("diffViewer.smart.filesCount", { count: group.files.length })}
              </span>
            </div>
            {!isCollapsed && (
              <div style={diffStyles.list}>
                {group.files.map((sf) => {
                  const file = fileByPath.get(sf.path);
                  if (!file) return null;
                  return (
                    <FileCard
                      key={sf.path}
                      file={file}
                      commenting={commenting}
                      findingLines={sf.finding_lines}
                      scrollToLine={sf.path === targetFile ? targetLine : undefined}
                      openSignal={sf.path === targetFile ? targetNonce : undefined}
                    />
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
