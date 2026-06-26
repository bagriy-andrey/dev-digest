"use client";

import React from "react";
import dynamic from "next/dynamic";
import { FormField, TextInput, SelectInput, Textarea, Button, Toggle, Badge } from "@devdigest/ui";
import type { Skill, SkillType } from "@devdigest/shared";
import { useUpdateSkill } from "@/lib/hooks/skills";
import { s } from "../../styles";

const MonacoEditor = dynamic(
  () => import("@monaco-editor/react").then((m) => m.default),
  { ssr: false, loading: () => <div style={{ height: 320, background: "var(--bg-elevated)" }} /> },
);

const TYPE_OPTIONS: { value: SkillType; label: string }[] = [
  { value: "rubric", label: "rubric" },
  { value: "convention", label: "convention" },
  { value: "security", label: "security" },
  { value: "custom", label: "custom" },
];

function approxTokens(text: string) {
  return Math.ceil(text.length / 4);
}

export function ConfigTab({ skill }: { skill: Skill }) {
  const update = useUpdateSkill();
  const [name, setName] = React.useState(skill.name);
  const [description, setDescription] = React.useState(skill.description);
  const [type, setType] = React.useState<SkillType>(skill.type);
  const [body, setBody] = React.useState(skill.body);
  const [enabled, setEnabled] = React.useState(skill.enabled);

  React.useEffect(() => {
    setName(skill.name);
    setDescription(skill.description);
    setType(skill.type);
    setBody(skill.body);
    setEnabled(skill.enabled);
  }, [skill.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const nameChanged = name !== skill.name;
  const descChanged = description !== skill.description;
  const typeChanged = type !== skill.type;
  const bodyChanged = body !== skill.body;
  const enabledChanged = enabled !== skill.enabled;
  const hasChanges = nameChanged || descChanged || typeChanged || bodyChanged || enabledChanged;

  const save = () =>
    update.mutate({
      id: skill.id,
      patch: {
        ...(nameChanged ? { name } : {}),
        ...(descChanged ? { description } : {}),
        ...(typeChanged ? { type } : {}),
        ...(bodyChanged ? { body } : {}),
        ...(enabledChanged ? { enabled } : {}),
      },
    });

  const cancel = () => {
    setName(skill.name);
    setDescription(skill.description);
    setType(skill.type);
    setBody(skill.body);
    setEnabled(skill.enabled);
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 15, fontWeight: 700 }}>Configuration</span>
          <Badge mono color="var(--text-muted)" bg="var(--bg-hover)">
            → v{skill.version}
          </Badge>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>Enabled</span>
          <Toggle on={enabled} onChange={setEnabled} />
        </div>
      </div>

      <FormField label="Name" required>
        <TextInput value={name} onChange={setName} placeholder="pr-quality-rubric" mono />
      </FormField>

      <FormField label="Description" hint="Describe the skill directively — the agent reads this as an instruction.">
        <Textarea value={description} onChange={setDescription} placeholder="Describe what this skill checks…" rows={2} />
      </FormField>

      <FormField label="Type">
        <SelectInput value={type} onChange={(v) => setType(v as SkillType)} options={TYPE_OPTIONS} />
      </FormField>

      <FormField label="Skill body" required>
        <div style={s.bodyEditorWrap}>
          <div style={s.bodyEditorHeader}>
            <span className="mono">{name || skill.name}.md</span>
            {bodyChanged && (
              <Badge color="var(--warn)" bg="rgba(234,179,8,0.15)" style={{ fontSize: 11 }}>
                unsaved
              </Badge>
            )}
            <span style={{ marginLeft: "auto" }}>{approxTokens(body)} tokens</span>
          </div>
          <MonacoEditor
            height={320}
            language="markdown"
            theme="vs-dark"
            value={body}
            onChange={(v) => setBody(v ?? "")}
            options={{
              minimap: { enabled: false },
              wordWrap: "on",
              lineNumbers: "on",
              fontSize: 13,
              fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
              scrollBeyondLastLine: false,
              padding: { top: 12, bottom: 12 },
            }}
          />
        </div>
        <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 8 }}>
          Saving a changed body creates a new immutable version.
        </div>
      </FormField>

      {hasChanges && (
        <div style={s.bodyActions}>
          <Button kind="primary" size="sm" loading={update.isPending} onClick={save}>
            Save
          </Button>
          <Button kind="secondary" size="sm" onClick={cancel}>
            Cancel
          </Button>
        </div>
      )}
    </div>
  );
}
