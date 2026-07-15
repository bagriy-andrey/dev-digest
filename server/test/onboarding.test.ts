/**
 * Onboarding generator (SPEC-01 onboarding-generator) — hermetic unit tests.
 * No DB, no network: pure post-processing helpers are tested directly;
 * `gatherManifestFacts` is exercised against a real temp dir (mirrors
 * `test/context.test.ts`'s `discoverDocs` pattern); `OnboardingService.generate`
 * is exercised end-to-end with a fully mocked `Container` (repo-intel facade +
 * `MockLLMProvider`) and the repository/repos fields overridden post-construction
 * with stub object literals (same pattern as `test/repo-intel-facade-degraded.test.ts`).
 *
 * Real-Postgres coverage (AC-5 end-to-end, AC-10 prior-doc-untouched, AC-12
 * single-row overwrite, AC-13 no-reindex-side-effect) lives in
 * `test/onboarding.it.test.ts` — couldn't be executed in this sandbox (see
 * `server/insights.md`'s Tool & Library Notes entry).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { OnboardingSection } from '@devdigest/shared';
import type { Container } from '../src/platform/container.js';
import { MockLLMProvider } from '../src/adapters/mocks.js';
import {
  gatherManifestFacts,
  renderSectionsVar,
  renderReadingPathFacts,
  renderRoutesFacts,
  buildKnownPaths,
  coerceSections,
  filterHallucinatedLinks,
  applyDegradedBackstop,
  costUsdToCents,
  OnboardingService,
} from '../src/modules/onboarding/service.js';
import { ONBOARDING_SECTIONS, DEGRADED_SECTION_BODY, MAX_MANIFEST_LINES } from '../src/modules/onboarding/constants.js';

// ---------------------------------------------------------------------------
// Pure helper tests
// ---------------------------------------------------------------------------

describe('renderSectionsVar', () => {
  it('renders all 5 sections, in fixed order, as "kind (Title)"', () => {
    expect(renderSectionsVar()).toBe(
      'tech_stack (Tech Stack), architecture (Architecture), routes_and_apis (Routes & APIs), ' +
        'reading_path (Reading Path), first_tasks (First Tasks)',
    );
  });
});

describe('renderReadingPathFacts (AC-3 — rank order only)', () => {
  it('renders top-ranked files then critical paths, in the given order', () => {
    const text = renderReadingPathFacts(['a.ts', 'b.ts'], [['a.ts', 'c.ts']]);
    expect(text).toContain('1. a.ts');
    expect(text).toContain('2. b.ts');
    expect(text).toContain('1. a.ts -> c.ts');
  });

  it('renders an empty string when both inputs are empty (empty edge graph)', () => {
    expect(renderReadingPathFacts([], [])).toBe('');
  });
});

describe('renderRoutesFacts (AC-4)', () => {
  it('joins endpoints one per line', () => {
    expect(renderRoutesFacts(['GET /a', 'POST /b'])).toBe('GET /a\nPOST /b');
  });
  it('is empty when there are no endpoints', () => {
    expect(renderRoutesFacts([])).toBe('');
  });
});

describe('buildKnownPaths', () => {
  it('unions manifest files, ranked files, critical-path files, and repo-map path-like tokens', () => {
    const known = buildKnownPaths({
      manifestFiles: ['package.json'],
      repoMapText: 'src/\n  index.ts\n  util.ts\n',
      topFiles: ['src/index.ts'],
      criticalPaths: [['src/index.ts', 'src/util.ts']],
    });
    expect(known.has('package.json')).toBe(true);
    expect(known.has('src/index.ts')).toBe(true);
    expect(known.has('src/util.ts')).toBe(true);
    expect(known.has('index.ts')).toBe(true); // extracted path-like token from repo-map text
  });
});

const KIND_ORDER = ONBOARDING_SECTIONS.map((s) => s.kind);

function section(overrides: Partial<OnboardingSection>): OnboardingSection {
  return { kind: 'tech_stack', title: 'x', body: '', diagram: null, links: [], ...overrides };
}

describe('coerceSections (AC-6/AC-8/AC-16 — exactly 5 sections, fixed order, diagram gate)', () => {
  it('reorders sections to the canonical kind order, matching by kind', () => {
    const model = [
      section({ kind: 'first_tasks', title: 'Model Tasks', body: 'do x' }),
      section({ kind: 'tech_stack', title: 'Model Stack', body: 'node' }),
      section({ kind: 'reading_path', title: 'Model Path', body: 'start here' }),
      section({ kind: 'architecture', title: 'Model Arch', body: 'layered', diagram: 'flowchart LR' }),
      section({ kind: 'routes_and_apis', title: 'Model Routes', body: 'GET /a' }),
    ];
    const result = coerceSections(model);
    expect(result.map((s) => s.kind)).toEqual(KIND_ORDER);
    expect(result[0]!.body).toBe('node'); // tech_stack, matched by kind despite model order
    expect(result[0]!.title).toBe('Tech Stack'); // canonical title always wins
  });

  it('falls back to positional match when a kind is renamed/missing', () => {
    const model = [
      section({ kind: 'stack', title: 'Weird', body: 'A' }), // renamed kind — positional fallback
      section({ kind: 'architecture', title: 'Arch', body: 'B' }),
      section({ kind: 'routes_and_apis', title: 'Routes', body: 'C' }),
      section({ kind: 'reading_path', title: 'Path', body: 'D' }),
      section({ kind: 'first_tasks', title: 'Tasks', body: 'E' }),
    ];
    const result = coerceSections(model);
    expect(result[0]!.kind).toBe('tech_stack');
    expect(result[0]!.body).toBe('A'); // positional fallback (index 0) since no kind match
  });

  it('produces an empty body/no links/null diagram when a section is entirely missing', () => {
    const model = [section({ kind: 'tech_stack', body: 'only this one' })];
    const result = coerceSections(model);
    expect(result).toHaveLength(5);
    expect(result.map((s) => s.kind)).toEqual(KIND_ORDER);
    expect(result[1]!.body).toBe(''); // architecture — nothing to fall back to
    expect(result[1]!.links).toEqual([]);
    expect(result[1]!.diagram).toBeNull();
  });

  it('nulls diagram on tech_stack/reading_path/first_tasks even if the model set one (AC-8)', () => {
    const model = [
      section({ kind: 'tech_stack', diagram: 'flowchart LR' }),
      section({ kind: 'architecture', diagram: 'flowchart LR' }),
      section({ kind: 'routes_and_apis', diagram: 'flowchart LR' }),
      section({ kind: 'reading_path', diagram: 'flowchart LR' }),
      section({ kind: 'first_tasks', diagram: 'flowchart LR' }),
    ];
    const result = coerceSections(model);
    const byKind = new Map(result.map((s) => [s.kind, s]));
    expect(byKind.get('tech_stack')!.diagram).toBeNull();
    expect(byKind.get('reading_path')!.diagram).toBeNull();
    expect(byKind.get('first_tasks')!.diagram).toBeNull();
    expect(byKind.get('architecture')!.diagram).toBe('flowchart LR');
    expect(byKind.get('routes_and_apis')!.diagram).toBe('flowchart LR');
  });
});

describe('filterHallucinatedLinks (AC-9)', () => {
  it('drops a link whose path is not in the known-paths set, keeps the rest', () => {
    const sections = [
      section({
        links: [
          { label: 'real', path: 'src/index.ts' },
          { label: 'invented', path: 'src/ghost.ts' },
        ],
      }),
    ];
    const result = filterHallucinatedLinks(sections, new Set(['src/index.ts']));
    expect(result[0]!.links).toEqual([{ label: 'real', path: 'src/index.ts' }]);
  });
});

describe('applyDegradedBackstop (AC-5)', () => {
  it('overwrites architecture/routes_and_apis/reading_path with the degraded marker, leaves tech_stack/first_tasks untouched', () => {
    const sections = ONBOARDING_SECTIONS.map((spec) =>
      section({ kind: spec.kind, title: spec.title, body: 'llm prose', links: [{ label: 'a', path: 'a.ts' }] }),
    );
    const result = applyDegradedBackstop(sections, true);
    const byKind = new Map(result.map((s) => [s.kind, s]));
    expect(byKind.get('architecture')!.body).toBe(DEGRADED_SECTION_BODY);
    expect(byKind.get('architecture')!.diagram).toBeNull();
    expect(byKind.get('architecture')!.links).toEqual([]);
    expect(byKind.get('routes_and_apis')!.body).toBe(DEGRADED_SECTION_BODY);
    expect(byKind.get('reading_path')!.body).toBe(DEGRADED_SECTION_BODY);
    expect(byKind.get('tech_stack')!.body).toBe('llm prose'); // untouched — manifest-derived
    expect(byKind.get('first_tasks')!.body).toBe('llm prose'); // untouched — free-form LLM prose
  });

  it('is a no-op when not degraded', () => {
    const sections = [section({ kind: 'architecture', body: 'real content' })];
    expect(applyDegradedBackstop(sections, false)).toEqual(sections);
  });
});

describe('costUsdToCents (AC-11)', () => {
  it('converts dollars to rounded integer cents', () => {
    expect(costUsdToCents(0.0123)).toBe(1);
    expect(costUsdToCents(1.006)).toBe(101); // rounds, doesn't truncate
    expect(costUsdToCents(0)).toBe(0);
  });

  it('passes through null (non-OpenRouter providers may return no cost)', () => {
    expect(costUsdToCents(null)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// gatherManifestFacts (AC-1 — real temp dir, first-variant-wins, truncation)
// ---------------------------------------------------------------------------

describe('gatherManifestFacts', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'onboarding-manifest-'));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('reads only files present in the allowlist, never walking the tree', async () => {
    await writeFile(join(root, 'package.json'), '{"name":"demo"}');
    await writeFile(join(root, 'not-in-allowlist.txt'), 'ignored');

    const facts = await gatherManifestFacts(root);
    expect(facts.filesUsed).toEqual(['package.json']);
    expect(facts.text).toContain('package.json');
    expect(facts.text).toContain('{"name":"demo"}');
    expect(facts.text).not.toContain('ignored');
  });

  it('first-variant-wins within a family: README.md is read, README (bare) is skipped', async () => {
    await writeFile(join(root, 'README.md'), '# Markdown readme');
    await writeFile(join(root, 'README'), 'plain readme');

    const facts = await gatherManifestFacts(root);
    expect(facts.filesUsed).toEqual(['README.md']);
    expect(facts.text).toContain('Markdown readme');
    expect(facts.text).not.toContain('plain readme');
  });

  it('truncates an oversized manifest file at MAX_MANIFEST_LINES', async () => {
    const bigContent = Array.from({ length: MAX_MANIFEST_LINES + 50 }, (_, i) => `line ${i}`).join('\n');
    await writeFile(join(root, 'package.json'), bigContent);

    const facts = await gatherManifestFacts(root);
    expect(facts.text).toContain(`…(50 more lines)`);
    expect(facts.text).not.toContain('line ' + (MAX_MANIFEST_LINES + 49));
  });

  it('returns empty facts when no manifest file exists', async () => {
    const facts = await gatherManifestFacts(root);
    expect(facts.filesUsed).toEqual([]);
    expect(facts.text).toBe('');
  });
});

// ---------------------------------------------------------------------------
// OnboardingService.generate — end-to-end wiring with a mocked Container
// ---------------------------------------------------------------------------

interface StubRow {
  json: { sections: OnboardingSection[] };
  sourceSha: string | null;
  generatedAt: Date;
}

function overrideRepos(svc: OnboardingService, clonePath: string | null): void {
  (svc as unknown as { repos: { getById: () => Promise<unknown> } }).repos = {
    getById: async () => (clonePath === null ? undefined : { clonePath, defaultBranch: 'main' }),
  };
}

function overrideRepo(svc: OnboardingService): {
  upsert: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
} {
  let lastRow: StubRow | null = null;
  const upsert = vi.fn(
    async (
      _repoId: string,
      input: { json: { sections: OnboardingSection[] }; sourceSha: string | null; costCents: number | null },
    ) => {
      lastRow = { json: input.json, sourceSha: input.sourceSha, generatedAt: new Date('2026-01-01T00:00:00.000Z') };
    },
  );
  const get = vi.fn(async () => lastRow);
  (svc as unknown as {
    repo: {
      get: typeof get;
      upsert: typeof upsert;
      toDoc: (row: StubRow | null) => unknown;
    };
  }).repo = {
    get,
    upsert,
    toDoc: (row: StubRow | null) =>
      row
        ? { onboarding: row.json, source_sha: row.sourceSha, generated_at: row.generatedAt.toISOString() }
        : { onboarding: null, source_sha: null, generated_at: null },
  };
  return { upsert, get };
}

function makeContainer(opts: { llm: MockLLMProvider; degraded?: boolean; repoIntelEnabled?: boolean }): Container {
  return {
    config: { repoIntelEnabled: opts.repoIntelEnabled ?? true },
    db: { select: () => ({ from: () => ({ where: async () => [] }) }) },
    llm: async () => opts.llm,
    repoIntel: {
      getIndexState: async () => ({
        repoId: 'repo-1',
        lastIndexedSha: 'sha-1',
        status: 'full',
        filesIndexed: 10,
        filesSkipped: 0,
        durationMs: 5,
        indexerVersion: 1,
        updatedAt: new Date(),
        degraded: opts.degraded ?? false,
      }),
      getRepoMap: async () => ({ text: 'src/index.ts\nsrc/util.ts\n', tokens: 10, cached: true }),
      getTopFilesByRank: async () => ['src/index.ts'],
      getCriticalPaths: async () => [['src/index.ts', 'src/util.ts']],
      getRepoEndpoints: async () => ['GET /health'],
    },
  } as unknown as Container;
}

const FIXTURE_SECTIONS: OnboardingSection[] = [
  {
    kind: 'tech_stack',
    title: 'Stack',
    body: 'Node + TypeScript',
    diagram: 'flowchart LR\nA-->B', // must get nulled — AC-8
    links: [{ label: 'package.json', path: 'package.json' }],
  },
  {
    kind: 'reading_path',
    title: 'Path',
    body: 'Start at the entrypoint',
    diagram: null,
    links: [{ label: 'index', path: 'src/index.ts' }],
  },
  {
    kind: 'architecture',
    title: 'Arch',
    body: 'Layered service',
    diagram: 'flowchart TD\nA-->B',
    links: [
      { label: 'ghost', path: 'src/ghost.ts' }, // hallucinated — dropped (AC-9)
      { label: 'util', path: 'src/util.ts' },
    ],
  },
  { kind: 'first_tasks', title: 'Tasks', body: 'Read the README first', diagram: null, links: [] },
  {
    kind: 'routes_and_apis',
    title: 'Routes',
    body: 'GET /health',
    diagram: 'flowchart LR\nC-->D',
    links: [],
  },
];

describe('OnboardingService.generate', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'onboarding-generate-'));
    await writeFile(join(root, 'package.json'), '{"name":"demo"}');
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('throws a clear error when the repo is not cloned yet, without calling the LLM', async () => {
    const llm = new MockLLMProvider('openai', { structured: { sections: FIXTURE_SECTIONS } });
    const container = makeContainer({ llm });
    const svc = new OnboardingService(container);
    overrideRepos(svc, null);
    overrideRepo(svc);

    await expect(svc.generate('ws-1', 'repo-1')).rejects.toThrow(/not cloned yet/i);
    expect(llm.calls).toHaveLength(0);
  });

  it('makes exactly ONE completeStructured call per generation (AC-6/AC-7)', async () => {
    const llm = new MockLLMProvider('openai', { structured: { sections: FIXTURE_SECTIONS } });
    const container = makeContainer({ llm });
    const svc = new OnboardingService(container);
    overrideRepos(svc, root);
    overrideRepo(svc);

    await svc.generate('ws-1', 'repo-1');

    const structuredCalls = llm.calls.filter((c) => c.method === 'completeStructured');
    expect(structuredCalls).toHaveLength(1);
    expect(llm.calls.filter((c) => c.method === 'embed')).toHaveLength(0);
  });

  it('persists exactly 5 sections in fixed order, diagram-gated and link-filtered, with sourceSha + cost cents (AC-11/AC-12)', async () => {
    const llm = new MockLLMProvider('openai', { structured: { sections: FIXTURE_SECTIONS } });
    const container = makeContainer({ llm });
    const svc = new OnboardingService(container);
    overrideRepos(svc, root);
    const { upsert } = overrideRepo(svc);

    const doc = await svc.generate('ws-1', 'repo-1');

    expect(upsert).toHaveBeenCalledTimes(1);
    const [repoIdArg, input] = upsert.mock.calls[0]!;
    expect(repoIdArg).toBe('repo-1');
    expect(input.sourceSha).toBe('sha-1');
    expect(input.costCents).toBe(0); // MockLLMProvider's fixed costUsd (0.001) rounds to 0 cents

    expect(doc.onboarding).not.toBeNull();
    const sections = doc.onboarding!.sections;
    expect(sections.map((s: OnboardingSection) => s.kind)).toEqual(KIND_ORDER);

    const byKind = new Map(sections.map((s: OnboardingSection) => [s.kind, s]));
    expect(byKind.get('tech_stack')!.diagram).toBeNull(); // AC-8
    expect(byKind.get('architecture')!.diagram).toBe('flowchart TD\nA-->B');
    expect(byKind.get('architecture')!.links).toEqual([{ label: 'util', path: 'src/util.ts' }]); // AC-9
    expect(doc.source_sha).toBe('sha-1');
  });

  it('applies the AC-5 degraded backstop end-to-end when the index is degraded', async () => {
    const llm = new MockLLMProvider('openai', { structured: { sections: FIXTURE_SECTIONS } });
    const container = makeContainer({ llm, degraded: true });
    const svc = new OnboardingService(container);
    overrideRepos(svc, root);
    overrideRepo(svc);

    const doc = await svc.generate('ws-1', 'repo-1');
    const byKind = new Map(doc.onboarding!.sections.map((s: OnboardingSection) => [s.kind, s]));

    expect(byKind.get('architecture')!.body).toBe(DEGRADED_SECTION_BODY);
    expect(byKind.get('routes_and_apis')!.body).toBe(DEGRADED_SECTION_BODY);
    expect(byKind.get('reading_path')!.body).toBe(DEGRADED_SECTION_BODY);
    expect(byKind.get('tech_stack')!.body).toBe('Node + TypeScript'); // still LLM-derived from manifest facts
    expect(byKind.get('first_tasks')!.body).toBe('Read the README first');
  });

  it('leaves the persisted row untouched and propagates the failure reason on an LLM error (AC-10)', async () => {
    const llm = new MockLLMProvider('openai', { structured: { sections: FIXTURE_SECTIONS } });
    llm.completeStructured = vi.fn().mockRejectedValue(new Error('provider unavailable'));
    const container = makeContainer({ llm });
    const svc = new OnboardingService(container);
    overrideRepos(svc, root);
    const { upsert } = overrideRepo(svc);

    await expect(svc.generate('ws-1', 'repo-1')).rejects.toThrow('provider unavailable');
    expect(upsert).not.toHaveBeenCalled();
  });
});
