"use client";

import React from "react";
import {
  Drawer,
  Tabs,
  FormField,
  TextInput,
  SelectInput,
  Textarea,
  Button,
  Badge,
} from "@devdigest/ui";
import type { SkillType, SkillSource } from "@devdigest/shared";
import {
  useCreateSkill,
  useImportSkillFile,
  useImportSkillUrl,
  useCommunitySkills,
  type ImportPreview,
} from "@/lib/hooks/skills";

const TYPE_OPTIONS: { value: SkillType; label: string }[] = [
  { value: "rubric", label: "rubric" },
  { value: "convention", label: "convention" },
  { value: "security", label: "security" },
  { value: "custom", label: "custom" },
];

const IMPORT_TABS = [
  { key: "file", label: "From file" },
  { key: "url", label: "From URL" },
  { key: "community", label: "Community" },
];

function PreviewForm({
  preview,
  source,
  onImport,
  loading,
}: {
  preview: ImportPreview;
  source: SkillSource;
  onImport: (name: string, description: string, type: SkillType) => void;
  loading: boolean;
}) {
  const [name, setName] = React.useState(preview.name);
  const [description, setDescription] = React.useState("");
  const [type, setType] = React.useState<SkillType>("custom");

  return (
    <div style={{ marginTop: 20, borderTop: "1px solid var(--border)", paddingTop: 20 }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>Preview</div>
      {source === "imported_url" && (
        <div
          style={{
            fontSize: 12,
            color: "var(--warn)",
            background: "rgba(234,179,8,0.1)",
            border: "1px solid rgba(234,179,8,0.3)",
            borderRadius: 6,
            padding: "8px 12px",
            marginBottom: 14,
          }}
        >
          This skill came from an external source. It will be stored <strong>disabled</strong> until
          you review and enable it.
        </div>
      )}
      <FormField label="Name" required>
        <TextInput value={name} onChange={setName} mono />
      </FormField>
      <FormField label="Description">
        <Textarea value={description} onChange={setDescription} rows={2} />
      </FormField>
      <FormField label="Type">
        <SelectInput value={type} onChange={(v) => setType(v as SkillType)} options={TYPE_OPTIONS} />
      </FormField>
      <div
        style={{
          fontSize: 12,
          color: "var(--text-muted)",
          background: "var(--bg-elevated)",
          borderRadius: 6,
          padding: "8px 12px",
          marginBottom: 14,
          fontFamily: "var(--font-mono, monospace)",
          maxHeight: 120,
          overflow: "auto",
          whiteSpace: "pre-wrap",
        }}
      >
        {preview.body.slice(0, 400)}{preview.body.length > 400 ? "\n…" : ""}
      </div>
      <div
        style={{
          fontSize: 12,
          color: "var(--text-muted)",
          background: "rgba(59,130,246,0.08)",
          borderRadius: 6,
          padding: "8px 12px",
          marginBottom: 16,
        }}
      >
        This skill&apos;s body is treated as data — it is never executed. Review it before enabling.
      </div>
      <Button kind="primary" size="sm" loading={loading} onClick={() => onImport(name, description, type)}>
        Import skill
      </Button>
    </div>
  );
}

function FileTab({ onSuccess }: { onSuccess: () => void }) {
  const importFile = useImportSkillFile();
  const create = useCreateSkill();
  const [preview, setPreview] = React.useState<ImportPreview | null>(null);

  const handleFile = async (file: File) => {
    setPreview(null);
    const result = await importFile.mutateAsync(file);
    setPreview(result);
  };

  const handleImport = async (name: string, description: string, type: SkillType) => {
    if (!preview) return;
    await create.mutateAsync({ name, description, type, body: preview.body, source: preview.source, enabled: true });
    onSuccess();
  };

  return (
    <div>
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const file = e.dataTransfer.files[0];
          if (file) handleFile(file);
        }}
        style={{
          border: "2px dashed var(--border-strong)",
          borderRadius: 8,
          padding: "32px 20px",
          textAlign: "center",
          color: "var(--text-secondary)",
          fontSize: 13,
          cursor: "pointer",
        }}
        onClick={() => document.getElementById("skill-file-input")?.click()}
      >
        <div style={{ marginBottom: 8 }}>Drop a <code>.md</code> or <code>.zip</code> file here</div>
        <div style={{ fontSize: 12, color: "var(--text-muted)" }}>or click to browse</div>
        <input
          id="skill-file-input"
          type="file"
          accept=".md,.zip"
          style={{ display: "none" }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
          }}
        />
      </div>
      {importFile.isPending && (
        <div style={{ marginTop: 12, fontSize: 13, color: "var(--text-muted)" }}>Parsing…</div>
      )}
      {preview && (
        <PreviewForm
          preview={preview}
          source={preview.source}
          onImport={handleImport}
          loading={create.isPending}
        />
      )}
    </div>
  );
}

function UrlTab({ onSuccess }: { onSuccess: () => void }) {
  const importUrl = useImportSkillUrl();
  const create = useCreateSkill();
  const [url, setUrl] = React.useState("");
  const [preview, setPreview] = React.useState<ImportPreview | null>(null);

  const handleFetch = async () => {
    setPreview(null);
    const result = await importUrl.mutateAsync(url);
    setPreview(result);
  };

  const handleImport = async (name: string, description: string, type: SkillType) => {
    if (!preview) return;
    await create.mutateAsync({
      name,
      description,
      type,
      body: preview.body,
      source: "imported_url",
      enabled: false,
    });
    onSuccess();
  };

  return (
    <div>
      <FormField
        label="Skill URL"
        hint="Fetched server-side, stored as untrusted, and left disabled until vetted."
      >
        <TextInput
          value={url}
          onChange={setUrl}
          placeholder="https://example.com/skills/security.md"
          mono
        />
      </FormField>
      <Button
        kind="primary"
        size="sm"
        loading={importUrl.isPending}
        disabled={!url.startsWith("http")}
        onClick={handleFetch}
      >
        Fetch
      </Button>
      {preview && (
        <PreviewForm
          preview={preview}
          source="imported_url"
          onImport={handleImport}
          loading={create.isPending}
        />
      )}
    </div>
  );
}

function CommunityTab({ onSuccess }: { onSuccess: () => void }) {
  const { data: skills, isLoading } = useCommunitySkills();
  const create = useCreateSkill();
  const [search, setSearch] = React.useState("");
  const [importing, setImporting] = React.useState<string | null>(null);

  const filtered = (skills ?? []).filter(
    (s) =>
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      s.description.toLowerCase().includes(search.toLowerCase()),
  );

  const handleImport = async (skill: { name: string; description: string; type: string }) => {
    setImporting(skill.name);
    await create.mutateAsync({
      name: skill.name,
      description: skill.description,
      type: (skill.type as SkillType) ?? "custom",
      body: `# ${skill.name}\n\n${skill.description}`,
      source: "community",
      enabled: false,
    });
    setImporting(null);
    onSuccess();
  };

  return (
    <div>
      <div style={{ marginBottom: 14 }}>
        <TextInput value={search} onChange={setSearch} placeholder="Search community skills…" />
      </div>
      {isLoading && <div style={{ fontSize: 13, color: "var(--text-muted)" }}>Loading…</div>}
      {filtered.map((skill) => (
        <div
          key={skill.name}
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 12,
            padding: "12px 0",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 13, fontWeight: 600 }}>
              {skill.name}
            </div>
            <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 2 }}>
              {skill.description}
            </div>
            <div style={{ marginTop: 4 }}>
              <Badge
                color="var(--text-muted)"
                bg="var(--bg-hover)"
                style={{ fontSize: 11 }}
              >
                {skill.type}
              </Badge>
              <span style={{ fontSize: 11, color: "var(--text-muted)", marginLeft: 8 }}>
                ★ {skill.stars}
              </span>
            </div>
          </div>
          <Button
            kind="secondary"
            size="sm"
            loading={importing === skill.name}
            onClick={() => handleImport(skill)}
          >
            Import
          </Button>
        </div>
      ))}
    </div>
  );
}

export function AddSkillDrawer({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = React.useState("file");

  return (
    <Drawer title="Add a skill" subtitle="Import from a file, a URL, or community skills" onClose={onClose}>
      <Tabs tabs={IMPORT_TABS} value={tab} onChange={setTab} pad="0" />
      <div style={{ marginTop: 20 }}>
        {tab === "file" && <FileTab onSuccess={onClose} />}
        {tab === "url" && <UrlTab onSuccess={onClose} />}
        {tab === "community" && <CommunityTab onSuccess={onClose} />}
      </div>
    </Drawer>
  );
}
