import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { AgentManifest, type CiFile } from '@devdigest/shared';
import { ValidationError } from '../../platform/errors.js';
import { ALLOWED_TRIGGERS, DEFAULT_TRIGGERS, MANIFEST_DIR, MEMORY_PATH, RUNNER_PATH, SKILLS_DIR, WORKFLOW_PATH } from './constants.js';

/**
 * Pure, unit-testable Export-to-CI domain helpers — zero I/O, zero DB, zero
 * `fastify`/`drizzle-orm` imports (onion boundary: `export-service.ts` is the
 * only caller that touches the filesystem/DB/GitHub).
 */

// ===========================================================================
// Slugs
// ===========================================================================

/** lowercase, non-alnum runs → `-`, trim, fallback `'skill'` for an all-symbol name. */
export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'skill';
}

/**
 * Deterministic disambiguation by first-occurrence order: `security-rules`,
 * `security-rules-2`, … — so e.g. "Security Rules" and "security rules"
 * (which both slugify to the same base) never collapse into one file.
 */
export function slugifyUnique(names: string[]): string[] {
  const counts = new Map<string, number>();
  return names.map((name) => {
    const base = slugify(name);
    const count = (counts.get(base) ?? 0) + 1;
    counts.set(base, count);
    return count === 1 ? base : `${base}-${count}`;
  });
}

// ===========================================================================
// Untrusted-input sanitization (D9) — `repo`/`triggers` reach here straight
// from `CiExportInput`, i.e. from the wizard's request body, and end up
// either interpolated into a workflow YAML file or used as a GitHub API path
// segment in someone else's repository. Never trust either verbatim.
// ===========================================================================

const REPO_REF_RE = /^[\w.-]+\/[\w.-]+$/;

export interface RepoRef {
  owner: string;
  name: string;
}

/** Regex-validated `owner/name` — throws `ValidationError` on anything else. */
export function parseRepoRef(repo: string): RepoRef {
  if (!REPO_REF_RE.test(repo)) {
    throw new ValidationError(`Invalid repository "${repo}" — expected "owner/name"`, { repo });
  }
  const [owner, name] = repo.split('/');
  return { owner: owner!, name: name! };
}

/**
 * Allowlist-filters `triggers` against `ALLOWED_TRIGGERS`, preserving THAT
 * list's canonical order (never the caller's order) — the output is built by
 * walking the allowlist and checking membership, so an unrecognized string in
 * the input can never reach the output regardless of what it contains. Falls
 * back to `DEFAULT_TRIGGERS` when the filtered set is empty.
 */
export function sanitizeTriggers(triggers: string[]): string[] {
  const requested = new Set(triggers);
  const filtered = ALLOWED_TRIGGERS.filter((t) => requested.has(t));
  return filtered.length > 0 ? filtered : [...DEFAULT_TRIGGERS];
}

// ===========================================================================
// Manifest (D1) — YAML is ALWAYS produced by the `yaml` package, never
// hand-rolled: a hand-rolled serializer mishandling a multi-line/quote-heavy
// `system_prompt` is a YAML-injection vector into someone else's repo.
// ===========================================================================

/** The subset of an agent row `buildManifest` needs — no Drizzle import here. */
export interface AgentManifestSource {
  name: string;
  provider: string;
  model: string;
  systemPrompt: string;
  strategy: string;
  ciFailOn: string;
}

/**
 * `{name, provider, model, system_prompt, skills, strategy, ci_fail_on}`
 * straight from the agent row — no CI-only transformation of any field
 * (AC-7, AC-54).
 */
export function buildManifest(agent: AgentManifestSource, skillSlugs: string[]): AgentManifest {
  return AgentManifest.parse({
    name: agent.name,
    provider: agent.provider,
    model: agent.model,
    system_prompt: agent.systemPrompt,
    skills: skillSlugs,
    strategy: agent.strategy,
    ci_fail_on: agent.ciFailOn,
  });
}

/** `stringify(AgentManifest.parse(manifest))` (D1) — never a hand-rolled serializer. */
export function manifestYaml(manifest: AgentManifest): string {
  return stringifyYaml(AgentManifest.parse(manifest));
}

// ===========================================================================
// Memory dump (D10) — workspace-scoped, capped, embedding-free.
// ===========================================================================

export interface MemoryRow {
  scope: string;
  kind: string;
  content: string;
  confidence: number | null;
  created_at: string | Date;
}

/** One JSON object per line; never `embedding`/`sources`. Empty input ⇒ `''` (AC-4). */
export function memoryJsonl(rows: MemoryRow[]): string {
  if (rows.length === 0) return '';
  return rows
    .map((row) =>
      JSON.stringify({
        scope: row.scope,
        kind: row.kind,
        content: row.content,
        confidence: row.confidence,
        created_at: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
      }),
    )
    .join('\n');
}

// ===========================================================================
// Bundle assembly
// ===========================================================================

export interface SkillFile {
  slug: string;
  body: string;
}

export interface BuildBundleInput {
  manifest: AgentManifest;
  manifestSlug: string;
  skills: SkillFile[];
  memoryRows: MemoryRow[];
  runnerBundle: string;
  workflowYaml: string;
}

/**
 * Assembles, in a stable order: manifest (exactly one, always — AC-2), one
 * skill file per manifest slug (AC-3), `memory.jsonl` (AC-4), the runner
 * bundle marked `editable: false` (AC-5/AC-28), then the workflow file.
 */
export function buildBundle(input: BuildBundleInput): CiFile[] {
  const files: CiFile[] = [
    {
      path: `${MANIFEST_DIR}/${input.manifestSlug}.yaml`,
      contents: manifestYaml(input.manifest),
      editable: true,
    },
  ];
  for (const skill of input.skills) {
    files.push({ path: `${SKILLS_DIR}/${skill.slug}.md`, contents: skill.body, editable: true });
  }
  files.push({ path: MEMORY_PATH, contents: memoryJsonl(input.memoryRows), editable: true });
  files.push({ path: RUNNER_PATH, contents: input.runnerBundle, editable: false });
  files.push({ path: WORKFLOW_PATH, contents: input.workflowYaml, editable: true });
  return files;
}

// ===========================================================================
// Preview-edit overrides (D3, AC-29 server half)
// ===========================================================================

/**
 * Applies an override ONLY when its `path` matches a generated path EXACTLY
 * and that generated file is `editable: true` — every other override entry
 * (unknown path, or a path whose generated file is `editable: false`, i.e.
 * the runner bundle) is dropped silently, never appended as a new file. A
 * manifest override that fails `AgentManifest` validation falls back to the
 * generated manifest so AC-1/AC-7 parity survives editing.
 */
export function applyFileOverrides(generated: CiFile[], overrides?: CiFile[]): CiFile[] {
  if (!overrides || overrides.length === 0) return generated;
  const overrideByPath = new Map(overrides.map((o) => [o.path, o]));
  return generated.map((file) => {
    if (!file.editable) return file; // e.g. the runner bundle — never overridable
    const override = overrideByPath.get(file.path);
    if (!override) return file;
    if (file.path.startsWith(`${MANIFEST_DIR}/`)) {
      try {
        if (!AgentManifest.safeParse(parseYaml(override.contents)).success) return file;
      } catch {
        return file; // not even valid YAML — keep the generated manifest
      }
    }
    return { ...file, contents: override.contents };
  });
}
