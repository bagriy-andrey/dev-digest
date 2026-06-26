"use client";

import React from "react";
import { Icon, Badge, Button, Tabs } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { ConfigTab } from "./_components/ConfigTab";
import { PreviewTab } from "./_components/PreviewTab";
import { StatsTab } from "./_components/StatsTab";
import { VersionsTab } from "./_components/VersionsTab";
import { SKILL_TYPE_COLORS, SKILL_TYPE_BG, DETAIL_TABS } from "./constants";
import { s } from "./styles";

export function SkillDetailPanel({
  skill,
  tab,
  onTab,
  onDelete,
}: {
  skill: Skill;
  tab: string;
  onTab: (t: string) => void;
  onDelete?: () => void;
}) {
  const typeColor = SKILL_TYPE_COLORS[skill.type] ?? "#6b7280";
  const typeBg = SKILL_TYPE_BG[skill.type] ?? "rgba(107,114,128,0.15)";

  const tabs = DETAIL_TABS.map((t) => ({ key: t.key, label: t.label }));
  const activeTab = tabs.find((t) => t.key === tab) ? tab : "config";

  return (
    <div style={s.detailBody}>
      <div style={s.detailHeader}>
        <Icon.Sparkles size={16} style={{ color: typeColor }} />
        <span style={s.detailTitle}>{skill.name}</span>
        <Badge color={typeColor} bg={typeBg} style={{ fontSize: 11 }}>
          {skill.type}
        </Badge>
        <Badge mono color="var(--text-muted)" bg="var(--bg-hover)" style={{ fontSize: 11 }}>
          → v{skill.version}
        </Badge>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          {onDelete && (
            <Button kind="ghost" size="sm" icon="Trash" onClick={onDelete} />
          )}
          <Button kind="secondary" size="sm" icon="Play" disabled>
            Run on evals
          </Button>
        </div>
      </div>

      <Tabs tabs={tabs} value={activeTab} onChange={onTab} pad="0 24px" />

      <div style={s.detailTabBody}>
        {activeTab === "config" && <ConfigTab skill={skill} />}
        {activeTab === "preview" && <PreviewTab skill={skill} />}
        {activeTab === "evals" && (
          <div style={{ color: "var(--text-muted)", fontSize: 13 }}>Evals coming soon.</div>
        )}
        {activeTab === "stats" && <StatsTab skillId={skill.id} />}
        {activeTab === "versions" && <VersionsTab skill={skill} />}
      </div>
    </div>
  );
}
