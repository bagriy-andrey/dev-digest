"use client";

/* PreviewStep — file list (workflow selected by default) + a code view.
   `editable: false` files (the runner bundle) render a short placeholder and
   NEVER their actual contents (AC-27/AC-28 — hundreds of KB of minified JS).
   Editing an editable file writes into the wizard's `edits` map (AC-29). */
import React from "react";
import { useTranslations } from "next-intl";
import { Badge, FormField, Icon, SectionLabel, Skeleton, Textarea } from "@devdigest/ui";
import type { CiFile } from "@/lib/types";
import { s } from "../styles";

export function PreviewStep({
  files,
  edits,
  onEditChange,
  selectedPath,
  onSelectedPathChange,
  isLoading,
}: {
  files: CiFile[];
  edits: Record<string, string>;
  onEditChange: (path: string, contents: string) => void;
  selectedPath: string | null;
  onSelectedPathChange: (path: string) => void;
  isLoading?: boolean;
}) {
  const t = useTranslations("ci");

  if (isLoading) {
    return <Skeleton height={280} />;
  }

  const selected = files.find((f) => f.path === selectedPath) ?? null;

  return (
    <div>
      <SectionLabel icon="FileText">{t("exportWizard.filesToCreate")}</SectionLabel>
      <div style={s.previewGrid}>
        <div style={s.fileList}>
          {files.map((f) => {
            const active = f.path === selectedPath;
            return (
              <button
                key={f.path}
                type="button"
                style={s.fileRow(active)}
                onClick={() => onSelectedPathChange(f.path)}
              >
                <Icon.File size={12} />
                <span style={s.filePath}>{f.path}</span>
                {f.editable && (
                  <Badge mono style={{ flexShrink: 0 }}>
                    {t("exportWizard.editable")}
                  </Badge>
                )}
              </button>
            );
          })}
        </div>

        <div style={s.codePane}>
          {!selected && <div style={s.placeholder}>{t("exportWizard.filesToCreate")}</div>}
          {selected && !selected.editable && (
            <div style={s.placeholder}>{t("exportWizard.runnerNotPreviewable")}</div>
          )}
          {selected && selected.editable && (
            <FormField label={selected.path}>
              <Textarea
                mono
                rows={14}
                value={edits[selected.path] ?? selected.contents}
                onChange={(v) => onEditChange(selected.path, v)}
              />
            </FormField>
          )}
        </div>
      </div>
    </div>
  );
}
