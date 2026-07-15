"use client";

/* ContextTab — Skill editor Screen 3 (SPEC-01 §1E, AC-13). Same row style as
   the Agent Context tab (Screen 2, AC-10): one row per DISCOVERED doc in the
   active repo, with an attach/detach checkbox and drag-to-reorder (persisted
   for attached docs only). Deliberately a SEPARATE component tree from
   `AgentEditor/_components/ContextTab` (skills and agents are different
   entities) even though the row/DnD/Preview pattern is mirrored. Differences
   from Screen 2: header badge is "X attached" (no "of Y"), a helper text line
   explains inheritance, and a read-only "SERIALIZES AS" box replaces the
   token-estimate footer (AC-13 doesn't call for a footer token count). */

import React from "react";
import { useTranslations } from "next-intl";
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  sortableKeyboardCoordinates,
  arrayMove,
} from "@dnd-kit/sortable";
import { Skeleton } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { useContextFiles } from "@/lib/hooks";
import { useSkillContextDocs, useSetSkillContextDocs } from "@/lib/hooks/context";
import { useActiveRepo } from "@/lib/repo-context";
import { ContextRow } from "./_components/ContextRow";
import { PreviewModal } from "./_components/PreviewModal";
import { buildOrderedPaths } from "./helpers";
import { s } from "./styles";

export function ContextTab({ skill }: { skill: Skill }) {
  const t = useTranslations("skills");
  const { activeRepo } = useActiveRepo();
  const repoId = activeRepo?.id ?? null;

  const { data: docs, isLoading: docsLoading } = useContextFiles(repoId);
  const { data: attachments, isLoading: attLoading } = useSkillContextDocs(skill.id);
  const setDocs = useSetSkillContextDocs();

  const [previewPath, setPreviewPath] = React.useState<string | null>(null);
  // Optimistic order (null = use server-derived order) — mirrors Screen 2.
  const [pendingOrder, setPendingOrder] = React.useState<string[] | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const docList = React.useMemo(() => docs ?? [], [docs]);
  const docByPath = React.useMemo(() => new Map(docList.map((d) => [d.path, d])), [docList]);
  const attachedSet = React.useMemo(
    () => new Set((attachments ?? []).map((a) => a.path)),
    [attachments],
  );

  const serverOrder = React.useMemo(
    () => buildOrderedPaths(docList, attachments ?? []),
    [docList, attachments],
  );

  const order = pendingOrder ?? serverOrder;

  // Clear pending order once server data matches (mirrors Screen 2).
  React.useEffect(() => {
    if (pendingOrder && serverOrder.join(",") === pendingOrder.join(",")) {
      setPendingOrder(null);
    }
  }, [serverOrder, pendingOrder]);

  function persist(nextOrder: string[], nextAttached: Set<string>) {
    if (!repoId) return;
    const paths = nextOrder.filter((p) => nextAttached.has(p));
    setDocs.mutate({ skillId: skill.id, repoId, paths });
  }

  function handleToggle(path: string) {
    const nextAttached = new Set(attachedSet);
    if (nextAttached.has(path)) nextAttached.delete(path);
    else nextAttached.add(path);
    persist(order, nextAttached);
  }

  function handleDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    const oldIndex = order.indexOf(active.id as string);
    const newIndex = order.indexOf(over.id as string);
    if (oldIndex === -1 || newIndex === -1) return;
    const reordered = arrayMove(order, oldIndex, newIndex);
    setPendingOrder(reordered);
    persist(reordered, attachedSet);
  }

  const isLoading = docsLoading || attLoading;
  const attachedCount = attachedSet.size;
  const totalCount = docList.length;
  // Paths this skill contributes, in the order they'll be injected (AC-13).
  const attachedOrder = order.filter((p) => attachedSet.has(p));

  if (!repoId) {
    return (
      <div style={s.root}>
        <div style={s.empty}>{t("context.noActiveRepo")}</div>
      </div>
    );
  }

  return (
    <div style={s.root}>
      <div style={s.header}>
        <div style={s.headerTop}>
          <span style={s.headerTitle}>{t("context.title")}</span>
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
            {t("context.attachedCount", { count: attachedCount })}
          </span>
        </div>
        <span style={s.headerHelper}>{t("context.helper")}</span>
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <div style={s.list}>
          {isLoading ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "8px 0" }}>
              <Skeleton height={20} />
              <Skeleton height={20} />
              <Skeleton height={20} />
            </div>
          ) : totalCount === 0 ? (
            <div style={s.empty}>{t("context.noDocs")}</div>
          ) : (
            <SortableContext items={order} strategy={verticalListSortingStrategy}>
              {order.map((path) => {
                const doc = docByPath.get(path);
                if (!doc) return null;
                return (
                  <ContextRow
                    key={path}
                    doc={doc}
                    attached={attachedSet.has(path)}
                    onToggle={() => handleToggle(path)}
                    onPreview={() => setPreviewPath(path)}
                  />
                );
              })}
            </SortableContext>
          )}
        </div>
      </DndContext>

      <div style={s.serializesBox}>
        <div style={s.serializesLabel}>{t("context.serializesAs")}</div>
        {attachedOrder.length === 0 ? (
          <span style={s.serializesEmpty}>{t("context.serializesEmpty")}</span>
        ) : (
          <ul style={s.serializesList}>
            {attachedOrder.map((path) => (
              <li key={path} style={s.serializesItem}>
                {path}
              </li>
            ))}
          </ul>
        )}
      </div>

      {previewPath && (
        <PreviewModal repoId={repoId} path={previewPath} onClose={() => setPreviewPath(null)} />
      )}
    </div>
  );
}
