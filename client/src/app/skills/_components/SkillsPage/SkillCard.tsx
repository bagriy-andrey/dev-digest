"use client";

import React from "react";
import { Icon, Badge, Toggle } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { useUpdateSkill, useSkillStats } from "@/lib/hooks/skills";
import { SKILL_TYPE_COLORS, SKILL_TYPE_BG } from "./constants";
import { s } from "./styles";

const SOURCE_LABELS: Record<string, string> = {
  manual: "Manual",
  extracted: "Extracted",
  community: "Community",
  imported_url: "Imported",
};

function SkillCardStats({ skillId }: { skillId: string }) {
  const { data } = useSkillStats(skillId);
  if (!data) {
    return (
      <div style={s.cardStats}>
        <span>— agents</span>
        <span>—% pull</span>
        <span>—% accept</span>
      </div>
    );
  }
  return (
    <div style={s.cardStats}>
      <span>{data.agentsCount} agents</span>
      <span>{data.pullFrequencyPct}% pull</span>
      <span style={{ color: "var(--ok)", fontWeight: 600 }}>{data.acceptRatePct}% accept</span>
    </div>
  );
}

export function SkillCard({
  skill,
  active,
  onClick,
}: {
  skill: Skill;
  active: boolean;
  onClick: () => void;
}) {
  const update = useUpdateSkill();
  const typeColor = SKILL_TYPE_COLORS[skill.type] ?? "#6b7280";
  const typeBg = SKILL_TYPE_BG[skill.type] ?? "rgba(107,114,128,0.15)";

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    update.mutate({ id: skill.id, patch: { enabled: !skill.enabled } });
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => e.key === "Enter" && onClick()}
      style={{ ...s.card, ...(active ? s.cardActive : s.cardInactive) }}
    >
      <div style={s.cardTop}>
        <Icon.Sparkles size={14} style={{ color: typeColor, flexShrink: 0 }} />
        <span className="mono" style={s.cardName}>{skill.name}</span>
        <div onClick={handleToggle}>
          <Toggle on={skill.enabled} onChange={() => {}} size={16} />
        </div>
      </div>
      <div style={s.cardDesc}>{skill.description}</div>
      <div style={s.cardBadges}>
        <Badge color={typeColor} bg={typeBg} style={{ fontSize: 11 }}>
          {skill.type}
        </Badge>
        <Badge color="var(--text-muted)" bg="var(--bg-hover)" style={{ fontSize: 11 }}>
          {SOURCE_LABELS[skill.source] ?? skill.source}
        </Badge>
      </div>
      <SkillCardStats skillId={skill.id} />
    </div>
  );
}
