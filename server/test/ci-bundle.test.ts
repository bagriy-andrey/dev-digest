/**
 * Export-to-CI (SPEC-04) — hermetic unit tests for `modules/ci/helpers.ts`
 * and `modules/ci/runner-bundle.ts`. No DB, no network, no LLM — pure
 * functions + one stubbed filesystem read.
 *
 * Workflow-YAML-specific assertions live in `test/ci-workflow.test.ts`.
 */
import { describe, it, expect } from 'vitest';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { AgentManifest, type CiFile } from '@devdigest/shared';
import {
  slugify,
  slugifyUnique,
  parseRepoRef,
  sanitizeTriggers,
  sanitizeBase,
  buildManifest,
  manifestYaml,
  memoryJsonl,
  buildBundle,
  applyFileOverrides,
  type AgentManifestSource,
  type MemoryRow,
} from '../src/modules/ci/helpers.js';
import { readRunnerBundle } from '../src/modules/ci/runner-bundle.js';
import { ConfigError, ValidationError } from '../src/platform/errors.js';
import { MANIFEST_DIR, MEMORY_PATH, RUNNER_PATH, SKILLS_DIR, WORKFLOW_PATH } from '../src/modules/ci/constants.js';

// A quote-heavy, multi-line, colon-containing prompt — the real AC-7
// YAML-injection stress case a hand-rolled serializer would mangle.
const SYSTEM_PROMPT = [
  'You are a "senior" reviewer.',
  'Rules:',
  '- Never say: "LGTM" without evidence.',
  "- Mixed quotes: 'single', \"double\", and a literal: colon: chain.",
  '- A trailing backslash test: C:\\Users\\dev',
].join('\n');

const AGENT: AgentManifestSource = {
  name: 'API Contract Reviewer',
  provider: 'openrouter',
  model: 'deepseek/deepseek-v4-flash',
  systemPrompt: SYSTEM_PROMPT,
  strategy: 'single-pass',
  ciFailOn: 'warning',
};

// ---------------------------------------------------------------------------
// slugify / slugifyUnique
// ---------------------------------------------------------------------------

describe('slugify', () => {
  it('lowercases and collapses non-alphanumeric runs to a single hyphen', () => {
    expect(slugify('Security Rules')).toBe('security-rules');
    expect(slugify('  Weird!!  Name__2 ')).toBe('weird-name-2');
  });

  it('falls back to "skill" for an all-symbol name', () => {
    expect(slugify('###')).toBe('skill');
  });
});

describe('slugifyUnique', () => {
  it('disambiguates deterministically by first-occurrence order (edge case 2)', () => {
    expect(slugifyUnique(['Security Rules', 'security rules', 'Other'])).toEqual([
      'security-rules',
      'security-rules-2',
      'other',
    ]);
  });

  it('produces distinct slugs (and therefore distinct files) for a 3-way collision', () => {
    const slugs = slugifyUnique(['a b', 'a-b', 'A_B']);
    expect(new Set(slugs).size).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// parseRepoRef (D9)
// ---------------------------------------------------------------------------

describe('parseRepoRef', () => {
  it('parses a valid owner/name ref', () => {
    expect(parseRepoRef('acme/widgets')).toEqual({ owner: 'acme', name: 'widgets' });
  });

  it('throws ValidationError on a malformed ref', () => {
    expect(() => parseRepoRef('not-a-repo')).toThrow(ValidationError);
    expect(() => parseRepoRef('a/b/c')).toThrow(ValidationError);
    expect(() => parseRepoRef('')).toThrow(ValidationError);
  });
});

// ---------------------------------------------------------------------------
// sanitizeBase (D9) — `base` gets the same untrusted-input discipline as
// `repo`/`triggers`: it reaches a GitHub `getRef`/`pulls.create` call, so an
// unvalidated value is a request-forgery/injection surface, not just a UX nit.
// ---------------------------------------------------------------------------

describe('sanitizeBase', () => {
  it('accepts a plain branch name and common ref-like names', () => {
    expect(sanitizeBase('main')).toBe('main');
    expect(sanitizeBase('release/2.0')).toBe('release/2.0');
    expect(sanitizeBase('feature-123')).toBe('feature-123');
  });

  it('throws ValidationError on refs with unsafe characters, traversal, or a leading dash/slash', () => {
    expect(() => sanitizeBase('main; rm -rf /')).toThrow(ValidationError);
    expect(() => sanitizeBase('../../etc/passwd')).toThrow(ValidationError);
    expect(() => sanitizeBase('-flag')).toThrow(ValidationError);
    expect(() => sanitizeBase('/main')).toThrow(ValidationError);
    expect(() => sanitizeBase('main/')).toThrow(ValidationError);
    expect(() => sanitizeBase('branch.lock')).toThrow(ValidationError);
    expect(() => sanitizeBase('has space')).toThrow(ValidationError);
    expect(() => sanitizeBase('')).toThrow(ValidationError);
  });
});

// ---------------------------------------------------------------------------
// sanitizeTriggers (D9) — the untrusted-input allowlist
// ---------------------------------------------------------------------------

describe('sanitizeTriggers', () => {
  it('filters to the allowlist in canonical order, ignoring input order', () => {
    expect(sanitizeTriggers(['reopened', 'opened'])).toEqual(['opened', 'reopened']);
  });

  it('drops unknown trigger strings entirely', () => {
    expect(sanitizeTriggers(['opened', 'issue_comment', 'push'])).toEqual(['opened']);
  });

  it('falls back to the default set when nothing survives the allowlist', () => {
    expect(sanitizeTriggers(['bogus', 'push'])).toEqual(['opened', 'synchronize']);
    expect(sanitizeTriggers([])).toEqual(['opened', 'synchronize']);
  });
});

// ---------------------------------------------------------------------------
// Manifest round-trip (AC-1, AC-7, AC-54, D1)
// ---------------------------------------------------------------------------

describe('buildManifest + manifestYaml round-trip', () => {
  it('serialized fields equal the agent config field-for-field (AC-7, AC-54)', () => {
    const manifest = buildManifest(AGENT, ['security-rules', 'style-guide']);
    expect(manifest).toEqual({
      name: AGENT.name,
      provider: AGENT.provider,
      model: AGENT.model,
      system_prompt: AGENT.systemPrompt,
      skills: ['security-rules', 'style-guide'],
      strategy: AGENT.strategy,
      ci_fail_on: AGENT.ciFailOn,
    });
  });

  it('yaml.parse + AgentManifest.safeParse deep-equals the input, even for a quote-heavy multi-line prompt (AC-1, AC-7)', () => {
    const manifest = buildManifest(AGENT, []);
    const yaml = manifestYaml(manifest);
    const parsed = AgentManifest.safeParse(parseYaml(yaml));
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).toEqual(manifest);
      expect(parsed.data.system_prompt).toBe(SYSTEM_PROMPT);
    }
  });

  it('carries ci_fail_on verbatim, not defaulted (AC-54)', () => {
    const manifest = buildManifest(AGENT, []);
    expect(manifest.ci_fail_on).toBe('warning');
  });
});

// ---------------------------------------------------------------------------
// memoryJsonl (D10, AC-4)
// ---------------------------------------------------------------------------

describe('memoryJsonl', () => {
  it('empty input produces an empty string, not a missing file', () => {
    expect(memoryJsonl([])).toBe('');
  });

  it('emits one JSON object per line and never an embedding field', () => {
    const rows: MemoryRow[] = [
      { scope: 'workspace', kind: 'lesson', content: 'A', confidence: 0.9, created_at: '2026-01-01T00:00:00.000Z' },
      { scope: 'workspace', kind: 'lesson', content: 'B', confidence: null, created_at: new Date('2026-01-02T00:00:00.000Z') },
    ];
    const jsonl = memoryJsonl(rows);
    const lines = jsonl.split('\n');
    expect(lines).toHaveLength(2);
    for (const line of lines) {
      const obj = JSON.parse(line);
      expect(obj).not.toHaveProperty('embedding');
      expect(obj).not.toHaveProperty('sources');
      expect(Object.keys(obj).sort()).toEqual(['confidence', 'content', 'created_at', 'kind', 'scope']);
    }
    expect(JSON.parse(lines[1]!).created_at).toBe('2026-01-02T00:00:00.000Z');
  });
});

// ---------------------------------------------------------------------------
// buildBundle (AC-2, AC-3, AC-4, AC-5, AC-6)
// ---------------------------------------------------------------------------

const FAKE_SECRET = 'sk-devdigest-fake-secret-do-not-leak-9f3a1c';
const RUNNER_BUNDLE_CONTENTS = '// pretend ncc bundle\nconsole.log("runner");\n';
const WORKFLOW_YAML = 'name: DevDigest Review\non:\n  pull_request:\n    types: [opened]\n';

function buildFixtureBundle(skillNames: string[]): CiFile[] {
  const manifest = buildManifest(AGENT, slugifyUnique(skillNames));
  const skills = slugifyUnique(skillNames).map((slug, i) => ({
    slug,
    body: `# ${skillNames[i]}\nSome rule text.`,
  }));
  return buildBundle({
    manifest,
    manifestSlug: 'api-contract-reviewer',
    skills,
    memoryRows: [],
    runnerBundle: RUNNER_BUNDLE_CONTENTS,
    workflowYaml: WORKFLOW_YAML,
  });
}

describe('buildBundle', () => {
  it('produces exactly one manifest file (AC-2)', () => {
    const files = buildFixtureBundle([]);
    const manifests = files.filter((f) => f.path.startsWith(`${MANIFEST_DIR}/`));
    expect(manifests).toHaveLength(1);
  });

  it('produces one skill file per slug, and Security Rules + security rules produce two distinct files (AC-3, edge case 2)', () => {
    const files = buildFixtureBundle(['Security Rules', 'security rules']);
    const skillFiles = files.filter((f) => f.path.startsWith(`${SKILLS_DIR}/`));
    expect(skillFiles.map((f) => f.path).sort()).toEqual(
      [`${SKILLS_DIR}/security-rules.md`, `${SKILLS_DIR}/security-rules-2.md`].sort(),
    );
  });

  it('zero skills ⇒ skills: [] in the manifest and no skill files', () => {
    const files = buildFixtureBundle([]);
    const skillFiles = files.filter((f) => f.path.startsWith(`${SKILLS_DIR}/`));
    expect(skillFiles).toHaveLength(0);
    const manifestFile = files.find((f) => f.path.startsWith(`${MANIFEST_DIR}/`))!;
    const parsed = AgentManifest.parse(parseYaml(manifestFile.contents));
    expect(parsed.skills).toEqual([]);
  });

  it('memory.jsonl is present and empty when there are no memory rows (AC-4)', () => {
    const files = buildFixtureBundle([]);
    const memory = files.find((f) => f.path === MEMORY_PATH);
    expect(memory).toBeDefined();
    expect(memory!.contents).toBe('');
  });

  it('the runner bundle is present and editable: false (AC-5)', () => {
    const files = buildFixtureBundle([]);
    const runner = files.find((f) => f.path === RUNNER_PATH);
    expect(runner).toBeDefined();
    expect(runner!.editable).toBe(false);
    expect(runner!.contents).toBe(RUNNER_BUNDLE_CONTENTS);
  });

  it('includes the workflow file', () => {
    const files = buildFixtureBundle([]);
    const workflow = files.find((f) => f.path === WORKFLOW_PATH);
    expect(workflow).toBeDefined();
    expect(workflow!.contents).toBe(WORKFLOW_YAML);
  });

  it('no generated file contains a configured secret value (AC-6)', () => {
    const files = buildFixtureBundle(['Security Rules']);
    for (const file of files) {
      expect(file.contents).not.toContain(FAKE_SECRET);
    }
  });
});

// ---------------------------------------------------------------------------
// applyFileOverrides (D3, AC-29 server half)
// ---------------------------------------------------------------------------

describe('applyFileOverrides', () => {
  it('returns the generated files unchanged when there are no overrides', () => {
    const generated = buildFixtureBundle([]);
    expect(applyFileOverrides(generated, undefined)).toEqual(generated);
    expect(applyFileOverrides(generated, [])).toEqual(generated);
  });

  it('an override for an editable generated path wins', () => {
    const generated = buildFixtureBundle([]);
    const workflowOverride: CiFile = { path: WORKFLOW_PATH, contents: 'name: Edited\n', editable: true };
    const result = applyFileOverrides(generated, [workflowOverride]);
    const workflow = result.find((f) => f.path === WORKFLOW_PATH)!;
    expect(workflow.contents).toBe('name: Edited\n');
  });

  it('an override for the runner bundle path is dropped (never overridable)', () => {
    const generated = buildFixtureBundle([]);
    const evilOverride: CiFile = { path: RUNNER_PATH, contents: 'process.exit(1)', editable: true };
    const result = applyFileOverrides(generated, [evilOverride]);
    const runner = result.find((f) => f.path === RUNNER_PATH)!;
    expect(runner.contents).toBe(RUNNER_BUNDLE_CONTENTS);
  });

  it('an override for an unknown path is dropped silently, never appended', () => {
    const generated = buildFixtureBundle([]);
    const unknown: CiFile = { path: 'not/a/real/path.txt', contents: 'x', editable: true };
    const result = applyFileOverrides(generated, [unknown]);
    expect(result).toHaveLength(generated.length);
    expect(result.find((f) => f.path === 'not/a/real/path.txt')).toBeUndefined();
  });

  it('a manifest override that breaks AgentManifest falls back to the generated manifest', () => {
    const generated = buildFixtureBundle([]);
    const manifestPath = generated.find((f) => f.path.startsWith(`${MANIFEST_DIR}/`))!.path;
    const brokenOverride: CiFile = { path: manifestPath, contents: 'not: [valid, agent, manifest', editable: true };
    const result = applyFileOverrides(generated, [brokenOverride]);
    const manifest = result.find((f) => f.path === manifestPath)!;
    expect(manifest.contents).toBe(generated.find((f) => f.path === manifestPath)!.contents);
  });

  it('a manifest override that IS a valid AgentManifest is applied', () => {
    const generated = buildFixtureBundle([]);
    const manifestPath = generated.find((f) => f.path.startsWith(`${MANIFEST_DIR}/`))!.path;
    const editedManifest = buildManifest({ ...AGENT, name: 'Edited Name' }, []);
    const override: CiFile = { path: manifestPath, contents: manifestYaml(editedManifest), editable: true };
    const result = applyFileOverrides(generated, [override]);
    const manifest = result.find((f) => f.path === manifestPath)!;
    expect(AgentManifest.parse(parseYaml(manifest.contents)).name).toBe('Edited Name');
  });
});

// ---------------------------------------------------------------------------
// readRunnerBundle
// ---------------------------------------------------------------------------

describe('readRunnerBundle', () => {
  it('reads the file at the configured path', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ci-runner-bundle-'));
    const path = join(dir, 'index.js');
    writeFileSync(path, RUNNER_BUNDLE_CONTENTS, 'utf8');
    try {
      expect(readRunnerBundle({ runnerBundlePath: path })).toBe(RUNNER_BUNDLE_CONTENTS);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('throws a ConfigError naming the exact fix command on ENOENT', () => {
    const missingPath = join(tmpdir(), 'ci-runner-bundle-does-not-exist', 'index.js');
    expect(() => readRunnerBundle({ runnerBundlePath: missingPath })).toThrow(ConfigError);
    try {
      readRunnerBundle({ runnerBundlePath: missingPath });
      expect.unreachable();
    } catch (err) {
      expect((err as Error).message).toContain('cd agent-runner && pnpm install && pnpm build');
    }
  });
});
