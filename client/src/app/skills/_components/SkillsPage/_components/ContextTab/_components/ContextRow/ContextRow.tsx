"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Checkbox, Badge, IconBtn } from "@devdigest/ui";
import type { ContextDoc } from "@/lib/types";
import { SOURCE_TYPE_ICON } from "../../constants";
import { filenameOf } from "../../helpers";
import { s } from "../../styles";

/** Six-dot drag handle, keyboard-focusable via the spread dnd-kit
 *  attributes/listeners (mirrors the Agent Context tab's `GripHandle`). */
function GripHandle(props: React.HTMLAttributes<HTMLDivElement> & { label: string }) {
  const { label, ...rest } = props;
  return (
    <div
      {...rest}
      role="button"
      aria-label={label}
      style={{
        cursor: "grab",
        color: "var(--text-muted)",
        padding: "0 4px",
        display: "flex",
        alignItems: "center",
        flexShrink: 0,
        touchAction: "none",
        ...(rest.style ?? {}),
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

/** One row per discovered doc: drag handle, attach/detach checkbox, filename,
 *  source-folder badge, Preview affordance (AC-13, same row style as AC-10). */
export function ContextRow({
  doc,
  attached,
  onToggle,
  onPreview,
}: {
  doc: ContextDoc;
  attached: boolean;
  onToggle: () => void;
  onPreview: () => void;
}) {
  const t = useTranslations("skills");
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: doc.path,
  });
  const name = filenameOf(doc.path);

  return (
    <div
      ref={setNodeRef}
      style={{
        ...s.row,
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.35 : 1,
      }}
    >
      <GripHandle
        {...attributes}
        {...listeners}
        label={t("context.dragHandle", { name })}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <Checkbox checked={attached} onChange={onToggle} label={<span style={s.rowFilename}>{name}</span>} />
      </div>
      <Badge icon={SOURCE_TYPE_ICON[doc.source_type]}>{t(`context.sourceType.${doc.source_type}`)}</Badge>
      <IconBtn icon="Eye" label={t("context.previewLabel", { name })} onClick={onPreview} />
    </div>
  );
}
