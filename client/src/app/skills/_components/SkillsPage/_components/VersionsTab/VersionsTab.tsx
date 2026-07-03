"use client";

import React from "react";
import { Badge, Markdown } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { useSkillVersions } from "@/lib/hooks/skills";
import { s } from "../../styles";

export function VersionsTab({ skill }: { skill: Skill }) {
  const { data: versions, isLoading } = useSkillVersions(skill.id);
  const [previewVersion, setPreviewVersion] = React.useState<number | null>(null);

  if (isLoading) {
    return <div style={{ color: "var(--text-muted)", fontSize: 13 }}>Loading versions…</div>;
  }

  const selected = versions?.find((v) => v.version === previewVersion);

  return (
    <div>
      {(versions ?? []).length === 0 ? (
        <div style={{ fontSize: 13, color: "var(--text-muted)" }}>No previous versions.</div>
      ) : (
        (versions ?? []).map((v) => (
          <div
            key={v.version}
            role="button"
            tabIndex={0}
            onClick={() => setPreviewVersion(previewVersion === v.version ? null : v.version)}
            onKeyDown={(e) => e.key === "Enter" && setPreviewVersion(previewVersion === v.version ? null : v.version)}
            style={{
              ...s.versionRow,
              background: previewVersion === v.version ? "var(--bg-elevated)" : "transparent",
              borderRadius: 6,
              paddingLeft: 8,
            }}
          >
            <span className="mono" style={{ fontWeight: 600, fontSize: 13 }}>
              v{v.version}
            </span>
            <span style={{ color: "var(--text-muted)", fontSize: 12 }}>
              {new Date(v.created_at).toLocaleDateString()}
            </span>
            {v.version === skill.version && (
              <Badge color="var(--ok)" bg="rgba(34,197,94,0.15)" style={{ fontSize: 11 }}>
                current
              </Badge>
            )}
          </div>
        ))
      )}

      {selected && (
        <div
          style={{
            marginTop: 20,
            border: "1px solid var(--border)",
            borderRadius: 8,
            padding: 20,
            background: "var(--bg-elevated)",
          }}
        >
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 12 }}>
            v{selected.version} body (read-only)
          </div>
          <Markdown>{selected.body}</Markdown>
        </div>
      )}
    </div>
  );
}
