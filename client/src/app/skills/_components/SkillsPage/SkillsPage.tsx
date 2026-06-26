"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Icon, Button, TextInput, EmptyState } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { useSkills, useDeleteSkill } from "@/lib/hooks/skills";
import { SkillCard } from "./SkillCard";
import { SkillDetailPanel } from "./SkillDetailPanel";
import { AddSkillDrawer } from "./AddSkillDrawer";
import { s } from "./styles";

export function SkillsPage({
  initialId,
  initialTab,
}: {
  initialId?: string;
  initialTab?: string;
}) {
  const t = useTranslations("skills");
  const router = useRouter();
  const { data: skills, isLoading, error } = useSkills();
  const deleteSkill = useDeleteSkill();

  const [selectedId, setSelectedId] = React.useState<string | undefined>(initialId);
  const [search, setSearch] = React.useState("");
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const [activeTab, setActiveTab] = React.useState(initialTab ?? "config");

  const filtered = React.useMemo(
    () =>
      (skills ?? [])
        .filter(
          (s) =>
            s.name.toLowerCase().includes(search.toLowerCase()) ||
            (s.description ?? "").toLowerCase().includes(search.toLowerCase()),
        )
        .sort((a, b) => a.name.localeCompare(b.name)),
    [skills, search],
  );

  const selected = skills?.find((s) => s.id === selectedId) ?? null;

  const handleSelect = (skill: Skill) => {
    setSelectedId(skill.id);
    setActiveTab("config");
    router.push(`/skills?id=${skill.id}&tab=config`, { scroll: false });
  };

  const handleTab = (t: string) => {
    setActiveTab(t);
    if (selectedId) router.push(`/skills?id=${selectedId}&tab=${t}`, { scroll: false });
  };

  const handleDelete = async (skill: Skill) => {
    if (!confirm(`Delete skill "${skill.name}"?`)) return;
    await deleteSkill.mutateAsync(skill.id);
    if (selectedId === skill.id) {
      setSelectedId(undefined);
      router.push("/skills");
    }
  };

  return (
    <div style={s.root}>
      {/* Left panel */}
      <div style={s.left}>
        <div style={s.leftHeader}>
          <span style={s.leftTitle}>{t("page.heading")}</span>
          <Button
            kind="primary"
            size="sm"
            icon="Plus"
            onClick={() => setDrawerOpen(true)}
          >
            {t("page.addSkill")}
          </Button>
        </div>

        <div style={s.searchWrap}>
          <TextInput
            value={search}
            onChange={setSearch}
            placeholder={t("page.searchPlaceholder")}
          />
        </div>

        <div style={s.list}>
          {isLoading && (
            <div style={{ padding: 16, fontSize: 13, color: "var(--text-muted)" }}>
              Loading…
            </div>
          )}
          {error && (
            <div style={{ padding: 16, fontSize: 13, color: "var(--error)" }}>
              {t("page.loadError")}
            </div>
          )}
          {!isLoading && !error && filtered.length === 0 && (
            <EmptyState
              title={t("page.empty.title")}
              body={t("page.empty.body")}
              cta={t("page.empty.cta")}
              onCta={() => setDrawerOpen(true)}
            />
          )}
          {filtered.map((skill) => (
            <SkillCard
              key={skill.id}
              skill={skill}
              active={skill.id === selectedId}
              onClick={() => handleSelect(skill)}
            />
          ))}
        </div>
      </div>

      {/* Right panel */}
      <div style={s.right}>
        {selected ? (
          <SkillDetailPanel
            skill={selected}
            tab={activeTab}
            onTab={handleTab}
            onDelete={() => handleDelete(selected)}
          />
        ) : (
          <div
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--text-muted)",
            }}
          >
            <div style={{ textAlign: "center" }}>
              <Icon.Sparkles size={32} style={{ marginBottom: 12, opacity: 0.3 }} />
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>
                {t("page.selectPrompt.title")}
              </div>
              <div style={{ fontSize: 13 }}>{t("page.selectPrompt.body")}</div>
            </div>
          </div>
        )}
      </div>

      {drawerOpen && <AddSkillDrawer onClose={() => setDrawerOpen(false)} />}
    </div>
  );
}
