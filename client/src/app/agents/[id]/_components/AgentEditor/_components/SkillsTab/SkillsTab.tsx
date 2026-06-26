"use client";

import React from "react";
import { useTranslations } from "next-intl";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  useDraggable,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Badge, Toggle, TextInput } from "@devdigest/ui";
import type { Agent, AgentSkillLink, Skill } from "@devdigest/shared";
import { useAgentSkills, useSkills, useLinkAgentSkill, useSetAgentSkills } from "@/lib/hooks/skills";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TYPE_COLORS: Record<string, string> = {
  rubric: "#3b82f6",
  convention: "#22c55e",
  security: "#ef4444",
  custom: "#6b7280",
};

function tc(type?: string) {
  return TYPE_COLORS[type ?? "custom"] ?? "#6b7280";
}

const DROPPABLE_ID = "agent-skills";

// ---------------------------------------------------------------------------
// Drag handle (6-dot grip, no external icon required)
// ---------------------------------------------------------------------------

function GripHandle(props: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...props}
      style={{
        cursor: "grab",
        color: "var(--text-muted)",
        padding: "0 4px",
        display: "flex",
        alignItems: "center",
        flexShrink: 0,
        touchAction: "none",
        ...(props.style ?? {}),
      }}
    >
      <svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor" aria-hidden>
        <circle cx="2.5" cy="2.5" r="1.5" />
        <circle cx="7.5" cy="2.5" r="1.5" />
        <circle cx="2.5" cy="7" r="1.5" />
        <circle cx="7.5" cy="7" r="1.5" />
        <circle cx="2.5" cy="11.5" r="1.5" />
        <circle cx="7.5" cy="11.5" r="1.5" />
      </svg>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Skill row (shared visual between left and right)
// ---------------------------------------------------------------------------

function SkillRowBody({
  skill,
  name,
  dimmed,
}: {
  skill?: Skill;
  name: string;
  dimmed?: boolean;
}) {
  const color = tc(skill?.type);
  return (
    <>
      <span
        style={{
          flex: 1,
          fontFamily: "var(--font-mono, monospace)",
          fontSize: 13,
          fontWeight: 600,
          color: dimmed ? "var(--text-muted)" : "inherit",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {name}
      </span>
      {skill?.type && (
        <Badge color={color} bg={`${color}22`} style={{ fontSize: 11, flexShrink: 0 }}>
          {skill.type}
        </Badge>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Left panel: sortable linked skill row
// ---------------------------------------------------------------------------

function SortableSkillRow({
  link,
  skill,
  onToggle,
  onRemove,
}: {
  link: AgentSkillLink;
  skill?: Skill;
  onToggle: () => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: link.skill_id,
    data: { type: "linked" },
  });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.35 : 1,
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "9px 10px 9px 4px",
        borderBottom: "1px solid var(--border)",
        background: "var(--bg-surface)",
      }}
    >
      <GripHandle {...attributes} {...listeners} />
      <SkillRowBody
        skill={skill}
        name={skill?.name ?? link.skill_id.slice(0, 8)}
        dimmed={!link.enabled}
      />
      <Toggle on={link.enabled} onChange={onToggle} size={16} />
      <button
        type="button"
        aria-label="Remove skill"
        onClick={onRemove}
        style={{
          background: "none",
          border: "none",
          cursor: "pointer",
          color: "var(--text-muted)",
          padding: "2px 2px 2px 4px",
          display: "flex",
          alignItems: "center",
          flexShrink: 0,
          lineHeight: 1,
        }}
      >
        ×
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Right panel: draggable available skill row
// ---------------------------------------------------------------------------

function DraggableSkillRow({ skill }: { skill: Skill }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `available::${skill.id}`,
    data: { type: "available", skillId: skill.id },
  });

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "9px 10px 9px 4px",
        borderBottom: "1px solid var(--border)",
        background: "var(--bg-elevated)",
        cursor: "grab",
        opacity: isDragging ? 0.35 : 1,
        userSelect: "none",
      }}
    >
      <GripHandle style={{ cursor: "grab" }} />
      <SkillRowBody skill={skill} name={skill.name} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Left panel drop zone wrapper
// ---------------------------------------------------------------------------

function AgentSkillsDropZone({
  children,
  isEmpty,
  dropHint,
}: {
  children: React.ReactNode;
  isEmpty: boolean;
  dropHint: string;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: DROPPABLE_ID });

  return (
    <div
      ref={setNodeRef}
      style={{
        flex: 1,
        overflowY: "auto",
        minHeight: 0,
        borderRadius: 4,
        transition: "background 0.12s",
        background: isOver ? "color-mix(in srgb, var(--accent) 6%, transparent)" : undefined,
        outline: isOver ? "2px dashed var(--accent)" : "2px dashed transparent",
        outlineOffset: -2,
      }}
    >
      {children}
      {isEmpty && (
        <div
          style={{
            padding: "20px 12px",
            fontSize: 13,
            color: "var(--text-muted)",
            textAlign: "center",
            lineHeight: 1.5,
          }}
        >
          {dropHint}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main SkillsTab
// ---------------------------------------------------------------------------

export function SkillsTab({ agent }: { agent: Agent }) {
  const t = useTranslations("agents");

  const { data: links, isLoading } = useAgentSkills(agent.id);
  const { data: allSkills } = useSkills();
  const linkSkill = useLinkAgentSkill();
  const setSkills = useSetAgentSkills();

  const [search, setSearch] = React.useState("");
  const [activeId, setActiveId] = React.useState<string | null>(null);
  // Optimistic order (null = use server order)
  const [pendingOrder, setPendingOrder] = React.useState<string[] | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  const skillById = React.useMemo(
    () => new Map((allSkills ?? []).map((s) => [s.id, s])),
    [allSkills],
  );

  const serverLinked = React.useMemo(
    () => [...(links ?? [])].sort((a, b) => a.order - b.order),
    [links],
  );

  // Apply pending optimistic order while mutations are in-flight
  const linked = React.useMemo(() => {
    if (!pendingOrder) return serverLinked;
    return pendingOrder
      .map((id) => serverLinked.find((l) => l.skill_id === id))
      .filter(Boolean) as AgentSkillLink[];
  }, [pendingOrder, serverLinked]);

  // Clear pending order once server data matches
  React.useEffect(() => {
    if (
      pendingOrder &&
      serverLinked.map((l) => l.skill_id).join(",") === pendingOrder.join(",")
    ) {
      setPendingOrder(null);
    }
  }, [serverLinked, pendingOrder]);

  const available = React.useMemo(() => {
    const ids = new Set(linked.map((l) => l.skill_id));
    return (allSkills ?? [])
      .filter(
        (s) =>
          !ids.has(s.id) &&
          s.name.toLowerCase().includes(search.toLowerCase()),
      )
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [allSkills, linked, search]);

  const enabledCount = linked.filter((l) => l.enabled).length;

  // Active dragged item meta (for overlay)
  const activeDraggedSkill = React.useMemo(() => {
    if (!activeId) return null;
    if (activeId.startsWith("available::")) {
      const skillId = activeId.slice("available::".length);
      return allSkills?.find((s) => s.id === skillId) ?? null;
    }
    return skillById.get(activeId) ?? null;
  }, [activeId, allSkills, skillById]);

  function handleDragStart({ active }: DragStartEvent) {
    setActiveId(active.id as string);
  }

  function handleDragEnd({ active, over }: DragEndEvent) {
    setActiveId(null);
    if (!over) return;

    const activeType = (active.data.current as { type: string } | undefined)?.type;

    if (activeType === "available") {
      const skillId = (active.data.current as { skillId: string }).skillId;
      linkSkill.mutate({ agentId: agent.id, skillId, order: linked.length, enabled: true });
      return;
    }

    if (activeType === "linked") {
      const activeSkillId = active.id as string;
      const overId = over.id as string;
      if (overId === DROPPABLE_ID || overId === activeSkillId) return;

      const oldIndex = linked.findIndex((l) => l.skill_id === activeSkillId);
      const newIndex = linked.findIndex((l) => l.skill_id === overId);
      if (oldIndex === -1 || newIndex === -1) return;

      const reordered = arrayMove(linked, oldIndex, newIndex);
      setPendingOrder(reordered.map((l) => l.skill_id));
      reordered.forEach((l, i) =>
        linkSkill.mutate({ agentId: agent.id, skillId: l.skill_id, order: i, enabled: l.enabled }),
      );
    }
  }

  function handleToggle(link: AgentSkillLink) {
    linkSkill.mutate({ agentId: agent.id, skillId: link.skill_id, enabled: !link.enabled });
  }

  function handleRemove(skillId: string) {
    const remaining = linked.filter((l) => l.skill_id !== skillId).map((l) => l.skill_id);
    setSkills.mutate({ agentId: agent.id, skillIds: remaining });
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div
        style={{
          display: "flex",
          height: "100%",
          minHeight: 0,
          gap: 0,
          overflow: "hidden",
        }}
      >
        {/* ---- LEFT: agent skills ---- */}
        <div
          style={{
            flex: "0 0 50%",
            display: "flex",
            flexDirection: "column",
            minHeight: 0,
            borderRight: "1px solid var(--border)",
            padding: "16px 16px 16px 24px",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: 8,
              marginBottom: 12,
              flexShrink: 0,
            }}
          >
            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-secondary)" }}>
              {t("skills.title")}
            </span>
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
              {t("skills.enabledCount", { linked: enabledCount, total: linked.length })}
            </span>
          </div>

          {isLoading ? (
            <div style={{ fontSize: 13, color: "var(--text-muted)" }}>Loading…</div>
          ) : (
            <SortableContext
              items={linked.map((l) => l.skill_id)}
              strategy={verticalListSortingStrategy}
            >
              <AgentSkillsDropZone isEmpty={linked.length === 0} dropHint={t("skills.dropHint")}>
                {linked.map((link) => (
                  <SortableSkillRow
                    key={link.skill_id}
                    link={link}
                    skill={skillById.get(link.skill_id)}
                    onToggle={() => handleToggle(link)}
                    onRemove={() => handleRemove(link.skill_id)}
                  />
                ))}
              </AgentSkillsDropZone>
            </SortableContext>
          )}
        </div>

        {/* ---- RIGHT: all available skills ---- */}
        <div
          style={{
            flex: "0 0 50%",
            display: "flex",
            flexDirection: "column",
            minHeight: 0,
            padding: "16px 24px 16px 16px",
            background: "var(--bg-elevated)",
          }}
        >
          <div style={{ flexShrink: 0, marginBottom: 10 }}>
            <div
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: "var(--text-secondary)",
                marginBottom: 8,
              }}
            >
              {t("skills.allSkillsTitle")}
            </div>
            <TextInput
              value={search}
              onChange={setSearch}
              placeholder={t("skills.filterPlaceholder")}
            />
          </div>

          <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
            {available.length === 0 && !search && (
              <div style={{ fontSize: 13, color: "var(--text-muted)", padding: "12px 0" }}>
                {t("skills.noAvailable")}
              </div>
            )}
            {available.length === 0 && search && (
              <div style={{ fontSize: 13, color: "var(--text-muted)", padding: "12px 0" }}>
                No skills match.
              </div>
            )}
            {available.map((skill) => (
              <DraggableSkillRow key={skill.id} skill={skill} />
            ))}
          </div>
        </div>
      </div>

      {/* Drag overlay — floating ghost while dragging */}
      <DragOverlay dropAnimation={null}>
        {activeId && activeDraggedSkill ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "9px 10px 9px 4px",
              background: "var(--bg-elevated)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
              fontSize: 13,
              fontWeight: 600,
              fontFamily: "var(--font-mono, monospace)",
              pointerEvents: "none",
              opacity: 0.9,
              minWidth: 200,
            }}
          >
            <GripHandle />
            <span style={{ flex: 1 }}>{activeDraggedSkill.name}</span>
            {activeDraggedSkill.type && (
              <Badge
                color={tc(activeDraggedSkill.type)}
                bg={`${tc(activeDraggedSkill.type)}22`}
                style={{ fontSize: 11 }}
              >
                {activeDraggedSkill.type}
              </Badge>
            )}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
