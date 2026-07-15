"use client";

/* ContextTab — Agent Editor Screen 2 (SPEC-01 §1E). One row per DISCOVERED
   doc in the active repo (not only attached ones), with an attach/detach
   checkbox, drag-to-reorder (persisted for attached docs only), and a
   view-only Preview affordance. Mirrors SkillsTab's dnd-kit + optimistic
   pendingOrder structure, merged into a single sortable list since every
   discovered doc gets a row (not a two-panel linked/available split). */

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
import type { Agent } from "@devdigest/shared";
import { useContextFiles } from "@/lib/hooks";
import { useAgentContextDocs, useSetAgentContextDocs } from "@/lib/hooks/context";
import { useActiveRepo } from "@/lib/repo-context";
import { ContextRow } from "./_components/ContextRow";
import { PreviewModal } from "./_components/PreviewModal";
import { buildOrderedPaths, estimateTokens } from "./helpers";
import { s } from "./styles";

export function ContextTab({ agent }: { agent: Agent }) {
  const t = useTranslations("agents");
  const { activeRepo } = useActiveRepo();
  const repoId = activeRepo?.id ?? null;

  const { data: docs, isLoading: docsLoading } = useContextFiles(repoId);
  const { data: attachments, isLoading: attLoading } = useAgentContextDocs(agent.id);
  const setDocs = useSetAgentContextDocs();

  const [previewPath, setPreviewPath] = React.useState<string | null>(null);
  // Optimistic order (null = use server-derived order) — mirrors SkillsTab.
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

  // Effective row order: the frozen pendingOrder (if any), with any doc path
  // not yet present (e.g. newly discovered via re-index) appended so it's
  // never silently hidden while frozen.
  const order = React.useMemo(() => {
    if (!pendingOrder) return serverOrder;
    const known = new Set(pendingOrder);
    const missing = docList.map((d) => d.path).filter((p) => !known.has(p));
    return missing.length ? [...pendingOrder, ...missing] : pendingOrder;
  }, [pendingOrder, serverOrder, docList]);

  // A toggle freezes `order` via setPendingOrder below; skip the very next
  // reconcile run because at that point `attachments` hasn't refetched yet,
  // so serverOrder is still trivially equal to what we just froze — without
  // this guard the effect immediately un-freezes it before the mutation
  // (and its attached-first regroup) ever lands, defeating the freeze.
  const skipNextReconcileRef = React.useRef(false);

  // Clear pending order once server data matches (mirrors SkillsTab) — only
  // relevant for drag-triggered freezes; toggle-triggered freezes are meant
  // to stay pinned for the session (see handleToggle).
  React.useEffect(() => {
    if (skipNextReconcileRef.current) {
      skipNextReconcileRef.current = false;
      return;
    }
    if (pendingOrder && serverOrder.join(",") === pendingOrder.join(",")) {
      setPendingOrder(null);
    }
  }, [serverOrder, pendingOrder]);

  function persist(nextOrder: string[], nextAttached: Set<string>) {
    if (!repoId) return;
    const paths = nextOrder.filter((p) => nextAttached.has(p));
    setDocs.mutate({ agentId: agent.id, repoId, paths });
  }

  function handleToggle(path: string) {
    const nextAttached = new Set(attachedSet);
    if (nextAttached.has(path)) nextAttached.delete(path);
    else nextAttached.add(path);
    // Freeze the current row order so toggling attach state doesn't jump the
    // row to the attached-first group mid-session — attach/detach persists
    // priority for injection, but must not visually reposition rows.
    skipNextReconcileRef.current = true;
    setPendingOrder(order);
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
  const tokenEstimate = estimateTokens(docList, [...attachedSet]);

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
        <span style={s.headerTitle}>{t("context.title")}</span>
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
          {t("context.attachedCount", { attached: attachedCount, total: totalCount })}
        </span>
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

      <div style={s.footer}>
        <span style={s.footerLine}>{t("context.tokenEstimate", { count: tokenEstimate })}</span>
        <span style={s.footerNote}>{t("context.injectedNote")}</span>
      </div>

      {previewPath && (
        <PreviewModal repoId={repoId} path={previewPath} onClose={() => setPreviewPath(null)} />
      )}
    </div>
  );
}
