"use client";

import { useTranslations } from "next-intl";
import { Icon, Badge } from "@devdigest/ui";
import type { ContextDoc } from "@/lib/types";
import { SOURCE_TYPE_ICON } from "../../constants";
import { filenameOf } from "../../helpers";
import { s } from "../../styles";

export function DocListItem({
  doc,
  active,
  onClick,
}: {
  doc: ContextDoc;
  active: boolean;
  onClick: () => void;
}) {
  const t = useTranslations("context");
  const I = Icon[SOURCE_TYPE_ICON[doc.source_type]];
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      style={{ ...s.row, ...(active ? s.rowActive : undefined) }}
    >
      <I size={14} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
      <span style={s.rowFilename}>{filenameOf(doc.path)}</span>
      <Badge>{t(`sourceType.${doc.source_type}`)}</Badge>
    </div>
  );
}
