/**
 * Project Context module (SPEC-01) — hermetic unit tests. No DB, no network:
 * `discoverDocs` is exercised against a real temp dir on disk (pure fs);
 * `dedupeOrderedPaths` / `computeCoverage` / `isSafeRelativePath` are pure
 * functions exported from `service.ts`, tested directly without a `Container`.
 *
 * DB-backed orchestration (`ContextService.listForRepo`/`resolveEffectiveSpecs`
 * end to end, attachment persistence) is covered by `test/context.it.test.ts`
 * (real Postgres — see that file's header for the sandbox limitation note).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discoverDocs } from '../src/modules/context/discovery.js';
import { DEFAULT_CONTEXT_FOLDERS } from '../src/modules/context/constants.js';
import {
  dedupeOrderedPaths,
  computeCoverage,
  isSafeRelativePath,
} from '../src/modules/context/service.js';

async function writeFileAt(root: string, rel: string, contents: string): Promise<void> {
  const full = join(root, rel);
  const dir = full.slice(0, full.lastIndexOf('/'));
  if (dir && dir !== root) await mkdir(dir, { recursive: true });
  await writeFile(full, contents);
}

describe('discoverDocs', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'context-discovery-'));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('discovers .md files under specs/docs/insights at any depth, tagged with the matching source_type (AC-1/AC-2)', async () => {
    await writeFileAt(root, 'specs/x.md', '# X\n');
    await writeFileAt(root, 'docs/guide/y.md', '# Y\n');
    await writeFileAt(root, 'server/insights.md', '# Insights\n');
    await writeFileAt(root, 'server/insights/deep/z.md', '# Z\n');

    const docs = await discoverDocs(root, DEFAULT_CONTEXT_FOLDERS);
    const byPath = new Map(docs.map((d) => [d.path, d]));

    expect(byPath.get('specs/x.md')?.source_type).toBe('specs');
    expect(byPath.get('docs/guide/y.md')?.source_type).toBe('docs');
    expect(byPath.get('server/insights/deep/z.md')?.source_type).toBe('insights');
    // `server/insights.md` is a FILE named insights.md, not inside an `insights/`
    // folder segment — must NOT match (folder-name matching, not filename matching).
    expect(byPath.has('server/insights.md')).toBe(false);
  });

  it('ignores non-.md files and files outside any configured folder', async () => {
    await writeFileAt(root, 'specs/readme.txt', 'not markdown');
    await writeFileAt(root, 'src/notes.md', '# not in a configured folder\n');
    await writeFileAt(root, 'specs/x.md', '# X\n');

    const docs = await discoverDocs(root, DEFAULT_CONTEXT_FOLDERS);
    expect(docs.map((d) => d.path)).toEqual(['specs/x.md']);
  });

  it('honors a custom folder-name set instead of the default (AC-3)', async () => {
    await writeFileAt(root, 'specs/x.md', '# X\n');
    await writeFileAt(root, 'legal/policy.md', '# Policy\n');

    const docs = await discoverDocs(root, ['legal']);
    expect(docs.map((d) => d.path)).toEqual(['legal/policy.md']);
    expect(docs[0]!.source_type).toBe('legal');
  });

  it('counts ATX (#…######) heading lines as the deterministic "chunks" proxy (AC-9)', async () => {
    await writeFileAt(
      root,
      'docs/x.md',
      [
        '# Title',
        'Some text.',
        '## Section one',
        'more text # not a heading (mid-line)',
        '###### Deepest heading',
        '####### Too many hashes — not ATX (H1-H6 only)',
        '#NoSpace not a heading',
      ].join('\n'),
    );

    const docs = await discoverDocs(root, DEFAULT_CONTEXT_FOLDERS);
    expect(docs).toHaveLength(1);
    expect(docs[0]!.headings).toBe(3); // Title, Section one, Deepest heading
  });

  it('returns [] for a missing/empty clone directory (graceful degradation)', async () => {
    const docs = await discoverDocs(join(root, 'does-not-exist'), DEFAULT_CONTEXT_FOLDERS);
    expect(docs).toEqual([]);
  });

  it('returns [] when given an empty folder set', async () => {
    await writeFileAt(root, 'specs/x.md', '# X\n');
    const docs = await discoverDocs(root, []);
    expect(docs).toEqual([]);
  });

  it('treats duplicate filenames under different folders as distinct docs keyed by path', async () => {
    await writeFileAt(root, 'server/specs/x.md', '# Server X\n');
    await writeFileAt(root, 'client/docs/x.md', '# Client X\n');

    const docs = await discoverDocs(root, DEFAULT_CONTEXT_FOLDERS);
    expect(docs.map((d) => d.path).sort()).toEqual(['client/docs/x.md', 'server/specs/x.md']);
  });

  it('never descends into a symlinked directory pointing outside the clone root', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'context-outside-'));
    await writeFileAt(outside, 'secret.md', '# Secret\n');
    await writeFileAt(root, 'specs/x.md', '# X\n');
    await symlink(outside, join(root, 'specs', 'escape'));

    try {
      const docs = await discoverDocs(root, DEFAULT_CONTEXT_FOLDERS);
      expect(docs.map((d) => d.path)).toEqual(['specs/x.md']);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
});

describe('isSafeRelativePath (path-guard)', () => {
  it('accepts a normal repo-relative path', () => {
    expect(isSafeRelativePath('specs/x.md')).toBe(true);
    expect(isSafeRelativePath('server/docs/deep/y.md')).toBe(true);
  });

  it('rejects an empty path', () => {
    expect(isSafeRelativePath('')).toBe(false);
  });

  it('rejects an absolute path', () => {
    expect(isSafeRelativePath('/etc/passwd')).toBe(false);
  });

  it('rejects a traversal path ("..")', () => {
    expect(isSafeRelativePath('../../etc/passwd')).toBe(false);
    expect(isSafeRelativePath('specs/../../../etc/passwd')).toBe(false);
    expect(isSafeRelativePath('specs/..')).toBe(false);
  });

  it('rejects a backslash or null byte (Windows-style traversal / poison-null)', () => {
    expect(isSafeRelativePath('specs\\..\\x.md')).toBe(false);
    expect(isSafeRelativePath('specs/x.md\0.png')).toBe(false);
  });

  it('rejects a bare "." segment', () => {
    expect(isSafeRelativePath('specs/./x.md')).toBe(false);
  });
});

describe('dedupeOrderedPaths (AC-14/AC-15 effective-set union/dedup/order)', () => {
  it('unions direct docs before skill docs, in their own group order', () => {
    const result = dedupeOrderedPaths(['a.md', 'b.md'], [['c.md', 'd.md']]);
    expect(result).toEqual(['a.md', 'b.md', 'c.md', 'd.md']);
  });

  it('a path present in both direct AND a skill group appears once, at its DIRECT position (agent-direct wins, AC-15)', () => {
    const result = dedupeOrderedPaths(['a.md', 'shared.md'], [['shared.md', 'c.md']]);
    expect(result).toEqual(['a.md', 'shared.md', 'c.md']);
  });

  it('a path reached via two enabled skills appears once', () => {
    const result = dedupeOrderedPaths([], [['x.md'], ['x.md', 'y.md']]);
    expect(result).toEqual(['x.md', 'y.md']);
  });

  it('empty direct + empty skill groups yields []', () => {
    expect(dedupeOrderedPaths([], [])).toEqual([]);
    expect(dedupeOrderedPaths([], [[]])).toEqual([]);
  });

  it('preserves skill-group order (skills listed in the agent-enabled order)', () => {
    const result = dedupeOrderedPaths([], [['skill1-a.md'], ['skill2-a.md']]);
    expect(result).toEqual(['skill1-a.md', 'skill2-a.md']);
  });
});

describe('computeCoverage (AC-8)', () => {
  it('is 0 when the workspace has zero agents (documented edge case)', () => {
    expect(computeCoverage(0, 0)).toBe(0);
    expect(computeCoverage(5, 0)).toBe(0); // defensive: never divide by zero even with a bogus usedBy
  });

  it('rounds to the nearest integer percentage', () => {
    expect(computeCoverage(1, 3)).toBe(33); // 33.33% -> 33
    expect(computeCoverage(2, 3)).toBe(67); // 66.67% -> 67
    expect(computeCoverage(1, 2)).toBe(50);
  });

  it('is 100 when every agent uses the doc', () => {
    expect(computeCoverage(4, 4)).toBe(100);
  });

  it('is 0 when no agent uses the doc', () => {
    expect(computeCoverage(0, 4)).toBe(0);
  });
});
