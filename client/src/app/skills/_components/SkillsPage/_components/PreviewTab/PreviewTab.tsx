"use client";

import React from "react";
import { Markdown } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { s } from "../../styles";

export function PreviewTab({ skill }: { skill: Skill }) {
  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>Preview</div>
        <div style={s.previewSubtitle}>Rendered as the reviewing agent receives it.</div>
      </div>
      <div style={s.previewCard}>
        <Markdown>{skill.body}</Markdown>
      </div>
    </div>
  );
}
