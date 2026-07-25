/**
 * PR Why + Risk Brief (SPEC-02) — hermetic unit tests. No DB, no network:
 * pure helpers (`buildBriefInput`, `groundBrief`, `smartDiffCounts`,
 * `changedPathsOf`, `capText`, `capSpecCorpus`) are tested directly;
 * `BriefService.generate` is exercised end-to-end with a mocked `Container`
 * (`MockLLMProvider`) and the news-up'd sibling repo/services (`repo`,
 * `blast`, `smartDiff`, `context`) overridden post-construction with stub
 * object literals — same pattern as `test/onboarding.test.ts`'s
 * `overrideRepo`/`overrideRepos`.
 *
 * Real-Postgres coverage (AC-3 linked-issue-failure, AC-4 no-specs, AC-11/
 * AC-12 upsert-overwrite, AC-13 route rate-limit source-read) lives in
 * `test/brief.it.test.ts` — couldn't be executed in this sandbox (see
 * `server/insights.md`'s Tool & Library Notes entry).
 */
import { describe, it, expect, vi } from 'vitest';
import type { SmartDiff, BlastRadius, Brief, Intent } from '@devdigest/shared';
import {
  Brief as BriefSchema,
  Risk as RiskSchema,
  RiskSeverity as RiskSeveritySchema,
  ReviewFocusItem as ReviewFocusItemSchema,
} from '@devdigest/shared';
import type { Container } from '../src/platform/container.js';
import { MockLLMProvider } from '../src/adapters/mocks.js';
import {
  BRIEF_SYSTEM_PROMPT,
  buildBriefInput,
  groundBrief,
  smartDiffCounts,
  changedPathsOf,
  capText,
  capSpecCorpus,
  type BriefFacts,
} from '../src/modules/brief/helpers.js';
import { BriefService } from '../src/modules/brief/service.js';

// ---------------------------------------------------------------------------
// buildBriefInput (AC-1/AC-2 — never the diff, only smart-diff counts + paths)
// ---------------------------------------------------------------------------

describe('buildBriefInput', () => {
  const baseFacts: BriefFacts = {
    intent: null,
    blastSummary: '',
    downstream: [],
    smartDiffCounts: { core: 2, wiring: 1, boilerplate: 3 },
    changedPaths: ['src/a.ts', 'src/b.ts'],
    specs: [],
  };

  it('includes only smart-diff group counts + changed-file paths, never diff body/hunk text (AC-1/AC-2)', () => {
    const { messages } = buildBriefInput(baseFacts);
    const all = messages.map((m) => m.content).join('\n');
    expect(all).toContain('core: 2 file(s)');
    expect(all).toContain('wiring: 1 file(s)');
    expect(all).toContain('boilerplate: 3 file(s)');
    expect(all).toContain('src/a.ts');
    expect(all).toContain('src/b.ts');
    // no unified-diff hunk headers or diff markers anywhere in the composed input
    expect(all).not.toMatch(/@@ -\d/);
    expect(all).not.toContain('diff --git');
    expect(all).not.toContain('pseudocode_summary');
  });

  it('wraps intent/blast/linked-issue/spec facts in <untrusted> blocks; smart-diff counts + paths stay unwrapped', () => {
    const facts: BriefFacts = {
      ...baseFacts,
      intent: { intent: 'add x', in_scope: ['x'], out_of_scope: [] },
      blastSummary: 'touches auth',
      linkedIssue: { title: 'Bug', body: 'steps to repro', state: 'open' },
      specs: [{ path: 'docs/spec.md', content: 'spec body' }],
    };
    const { messages } = buildBriefInput(facts);
    const user = messages.find((m) => m.role === 'user')!.content;
    expect(user).toContain('<untrusted source="intent">');
    expect(user).toContain('<untrusted source="blast">');
    expect(user).toContain('<untrusted source="linked-issue">');
    expect(user).toContain('<untrusted source="spec-0">');
    // the smart-diff count line + changed-file list appear before the first untrusted block
    const beforeFirstUntrusted = user.split('<untrusted')[0]!;
    expect(beforeFirstUntrusted).toContain('core: 2 file(s)');
    expect(beforeFirstUntrusted).toContain('src/a.ts');
  });

  it('system prompt treats <untrusted> blocks as data and states the model never receives the raw diff', () => {
    expect(BRIEF_SYSTEM_PROMPT).toMatch(/<untrusted/);
    expect(BRIEF_SYSTEM_PROMPT).toMatch(/NEVER instructions/);
    expect(BRIEF_SYSTEM_PROMPT).toMatch(/do not receive the raw diff/i);
  });

  it('returns inputChars (Σ message content length) and estBriefTokens ≈ chars/4', () => {
    const { messages, inputChars, estBriefTokens } = buildBriefInput(baseFacts);
    const expectedChars = messages.reduce((sum, m) => sum + m.content.length, 0);
    expect(inputChars).toBe(expectedChars);
    expect(estBriefTokens).toBe(Math.ceil(expectedChars / 4));
  });
});

// ---------------------------------------------------------------------------
// groundBrief (AC-9 backstop, AC-10 empty-is-valid)
// ---------------------------------------------------------------------------

describe('groundBrief', () => {
  const brief: Brief = {
    what: 'x',
    why: 'y',
    risk_level: 'medium',
    risks: [
      {
        kind: 'k',
        title: 't',
        explanation: 'e',
        severity: 'high',
        file_refs: ['src/real.ts', 'src/ghost.ts'],
      },
    ],
    review_focus: [
      { file: 'src/real.ts', reason: 'real focus' },
      { file: 'src/ghost.ts', reason: 'invented focus' },
    ],
  };

  it('drops invented file_refs/review_focus.file entries, keeps real ones (AC-9)', () => {
    const grounded = groundBrief(brief, new Set(['src/real.ts']));
    expect(grounded.risks[0]!.file_refs).toEqual(['src/real.ts']);
    expect(grounded.review_focus).toEqual([{ file: 'src/real.ts', reason: 'real focus' }]);
  });

  it('never throws and yields empty arrays when nothing in the brief matches the real changed set (AC-10)', () => {
    expect(() => groundBrief(brief, new Set())).not.toThrow();
    const grounded = groundBrief(brief, new Set());
    expect(grounded.risks[0]!.file_refs).toEqual([]);
    expect(grounded.review_focus).toEqual([]);
  });

  it('an empty risks[] input stays a valid Brief after grounding (AC-10)', () => {
    const emptyBrief: Brief = { what: 'x', why: 'y', risk_level: 'low', risks: [], review_focus: [] };
    const grounded = groundBrief(emptyBrief, new Set(['a.ts']));
    expect(() => BriefSchema.parse(grounded)).not.toThrow();
    expect(grounded.risks).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Contract shape (AC-6, AC-7): reused Risk/RiskSeverity, review_focus {file,reason}[]
// ---------------------------------------------------------------------------

describe('Brief contract shape (AC-6/AC-7)', () => {
  it('risks[]/risk_level are the reused shared Risk/RiskSeverity schemas; review_focus is {file,reason}[]', () => {
    const risk = { kind: 'k', title: 't', explanation: 'e', severity: 'low', file_refs: [] };
    expect(RiskSchema.parse(risk)).toEqual(risk);
    expect(RiskSeveritySchema.parse('low')).toBe('low');
    const focusItem = { file: 'a.ts', reason: 'why look here' };
    expect(ReviewFocusItemSchema.parse(focusItem)).toEqual(focusItem);
    // no `line` field on ReviewFocusItem per the spec's resolved default
    expect(ReviewFocusItemSchema.safeParse({ ...focusItem, line: 5 }).success).toBe(true); // extra keys stripped, not rejected
    expect(Object.keys(ReviewFocusItemSchema.parse({ ...focusItem, line: 5 }))).toEqual(['file', 'reason']);

    const brief = { what: 'w', why: 'y', risk_level: 'low', risks: [risk], review_focus: [focusItem] };
    expect(BriefSchema.parse(brief)).toEqual(brief);
  });
});

// ---------------------------------------------------------------------------
// smartDiffCounts / changedPathsOf / capText / capSpecCorpus
// ---------------------------------------------------------------------------

describe('smartDiffCounts', () => {
  it('sums file counts per role across every group', () => {
    const sd: SmartDiff = {
      groups: [
        { role: 'core', files: [{ path: 'a', additions: 1, deletions: 0, finding_lines: [] }] },
        { role: 'core', files: [{ path: 'b', additions: 1, deletions: 0, finding_lines: [] }] },
        { role: 'wiring', files: [{ path: 'c', additions: 1, deletions: 0, finding_lines: [] }] },
      ],
      split_suggestion: { too_big: false, total_lines: 3, proposed_splits: [] },
    };
    expect(smartDiffCounts(sd)).toEqual({ core: 2, wiring: 1, boilerplate: 0 });
  });

  it('is all-zero for an empty group set (a PR never reviewed still yields a valid brief)', () => {
    const sd: SmartDiff = { groups: [], split_suggestion: { too_big: false, total_lines: 0, proposed_splits: [] } };
    expect(smartDiffCounts(sd)).toEqual({ core: 0, wiring: 0, boilerplate: 0 });
  });
});

describe('changedPathsOf', () => {
  it('maps pr_files rows to a plain path array', () => {
    expect(changedPathsOf([{ path: 'a.ts' }, { path: 'b.ts' }])).toEqual(['a.ts', 'b.ts']);
  });
});

describe('capText', () => {
  it('passes text under the cap through unchanged', () => {
    expect(capText('hello', 10)).toBe('hello');
  });

  it('truncates with a notice beyond the cap', () => {
    const capped = capText('0123456789', 5);
    expect(capped.startsWith('01234')).toBe(true);
    expect(capped).toContain('more character(s) truncated');
  });
});

describe('capSpecCorpus', () => {
  it('keeps every spec untouched when the whole corpus is under the budget', () => {
    const specs = [
      { path: 'a.md', content: '12345' },
      { path: 'b.md', content: '12345' },
    ];
    expect(capSpecCorpus(specs, 100)).toEqual(specs);
  });

  it('truncates the doc that crosses the total budget and drops every doc after it', () => {
    const specs = [
      { path: 'a.md', content: '1234567890' },
      { path: 'b.md', content: 'should be dropped entirely' },
    ];
    const capped = capSpecCorpus(specs, 5);
    expect(capped).toHaveLength(1);
    expect(capped[0]!.path).toBe('a.md');
    expect(capped[0]!.content.startsWith('12345')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// BriefService.generate — end-to-end wiring with a mocked Container
// ---------------------------------------------------------------------------

const EMPTY_SMART_DIFF: SmartDiff = {
  groups: [],
  split_suggestion: { too_big: false, total_lines: 0, proposed_splits: [] },
};

const EMPTY_BLAST: BlastRadius = { changed_symbols: [], downstream: [], prior_prs: [], summary: '' };

const FIXTURE_BRIEF: Brief = {
  what: 'Adds a new endpoint',
  why: 'Supports the risk-brief feature',
  risk_level: 'medium',
  risks: [
    { kind: 'security', title: 'New surface', explanation: 'new route added', severity: 'medium', file_refs: ['src/a.ts'] },
  ],
  review_focus: [{ file: 'src/a.ts', reason: 'core logic change' }],
};

interface StubPull {
  id: string;
  workspaceId: string;
  repoId: string;
  number: number;
  title: string;
  body: string | null;
}

function makePull(overrides: Partial<StubPull> = {}): StubPull {
  return { id: 'pr-1', workspaceId: 'ws-1', repoId: 'repo-1', number: 42, title: 'Add x', body: 'desc', ...overrides };
}

function overrideRepo(
  svc: BriefService,
  opts: {
    pull?: StubPull | undefined;
    repoRow?: { owner: string; name: string } | undefined;
    intent?: Intent | null;
    files?: { path: string }[];
  },
): { upsertBrief: ReturnType<typeof vi.fn>; getLastBrief: () => Brief | undefined } {
  let lastBrief: Brief | undefined;
  const upsertBrief = vi.fn(async (_prId: string, brief: Brief) => {
    lastBrief = brief;
  });
  (
    svc as unknown as {
      repo: {
        getPull: () => Promise<StubPull | undefined>;
        getRepo: () => Promise<{ owner: string; name: string } | undefined>;
        getIntent: () => Promise<Intent | null | undefined>;
        getPrFiles: () => Promise<{ path: string }[]>;
        upsertBrief: typeof upsertBrief;
        getBrief: () => Promise<Brief | undefined>;
      };
    }
  ).repo = {
    getPull: async () => opts.pull,
    getRepo: async () => opts.repoRow,
    getIntent: async () => opts.intent ?? null,
    getPrFiles: async () => opts.files ?? [],
    upsertBrief,
    getBrief: async () => lastBrief,
  };
  return { upsertBrief, getLastBrief: () => lastBrief };
}

function overrideBlast(svc: BriefService, result: BlastRadius): void {
  (svc as unknown as { blast: { get: () => Promise<BlastRadius> } }).blast = { get: async () => result };
}

function overrideSmartDiff(svc: BriefService, smartDiff: SmartDiff): void {
  (svc as unknown as { smartDiff: { get: () => Promise<SmartDiff> } }).smartDiff = { get: async () => smartDiff };
}

function overrideContext(svc: BriefService, docs: { path: string }[] = [], contents: Record<string, string> = {}): void {
  (
    svc as unknown as {
      context: {
        listForRepo: () => Promise<{ path: string }[]>;
        getFileContent: (workspaceId: string, repoId: string, path: string) => Promise<{ path: string; content: string }>;
      };
    }
  ).context = {
    listForRepo: async () => docs,
    getFileContent: async (_ws, _repo, path) => {
      if (!(path in contents)) throw new Error(`no such doc: ${path}`);
      return { path, content: contents[path]! };
    },
  };
}

function makeContainer(opts: { llm: MockLLMProvider }): Container {
  return {
    db: { select: () => ({ from: () => ({ where: async () => [] }) }) },
    llm: async () => opts.llm,
    github: async () => {
      throw new Error('offline');
    },
  } as unknown as Container;
}

function wireService(llm: MockLLMProvider): { svc: BriefService; upsertBrief: ReturnType<typeof vi.fn> } {
  const container = makeContainer({ llm });
  const svc = new BriefService(container);
  const pull = makePull();
  const { upsertBrief } = overrideRepo(svc, {
    pull,
    repoRow: { owner: 'o', name: 'n' },
    files: [{ path: 'src/a.ts' }],
  });
  overrideBlast(svc, EMPTY_BLAST);
  overrideSmartDiff(svc, EMPTY_SMART_DIFF);
  overrideContext(svc);
  return { svc, upsertBrief };
}

describe('BriefService.generate', () => {
  it('makes exactly ONE completeStructured call per generation (AC-5)', async () => {
    const llm = new MockLLMProvider('openai', { structured: FIXTURE_BRIEF });
    const { svc } = wireService(llm);

    await svc.generate('ws-1', 'pr-1');

    const structuredCalls = llm.calls.filter((c) => c.method === 'completeStructured');
    expect(structuredCalls).toHaveLength(1);
  });

  it('persists the grounded brief exactly once, dropping any refs outside the real changed-file set (AC-9/AC-11)', async () => {
    const briefWithGhost: Brief = {
      ...FIXTURE_BRIEF,
      risks: [{ ...FIXTURE_BRIEF.risks[0]!, file_refs: ['src/a.ts', 'src/invented-ghost.ts'] }],
      review_focus: [
        { file: 'src/a.ts', reason: 'core logic change' },
        { file: 'src/invented-ghost.ts', reason: 'hallucinated' },
      ],
    };
    const llm = new MockLLMProvider('openai', { structured: briefWithGhost });
    const { svc, upsertBrief } = wireService(llm);

    const { brief } = await svc.generate('ws-1', 'pr-1');

    expect(upsertBrief).toHaveBeenCalledTimes(1);
    expect(brief.risks[0]!.file_refs).toEqual(['src/a.ts']);
    expect(brief.review_focus).toEqual([{ file: 'src/a.ts', reason: 'core logic change' }]);
  });

  it('does NOT persist when the LLM response is not a valid Brief — prior cached brief stays untouched (AC-8)', async () => {
    const llm = new MockLLMProvider('openai', { structured: FIXTURE_BRIEF });
    llm.completeStructured = vi.fn().mockResolvedValue({
      data: { nonsense: true },
      model: 'test-model',
      tokensIn: 1,
      tokensOut: 1,
      costUsd: 0,
      raw: '{}',
      attempts: 1,
    });
    const { svc, upsertBrief } = wireService(llm);

    await expect(svc.generate('ws-1', 'pr-1')).rejects.toThrow(/invalid response shape/i);
    expect(upsertBrief).not.toHaveBeenCalled();
  });

  it('logs model/tokens/inputChars on success; none of those appear in the returned brief (AC-14)', async () => {
    const llm = new MockLLMProvider('openai', { structured: FIXTURE_BRIEF });
    const { svc } = wireService(llm);
    const info = vi.fn();
    const logger = { info, warn: vi.fn(), error: vi.fn() };

    const { brief, metrics } = await svc.generate('ws-1', 'pr-1', logger);

    expect(info).toHaveBeenCalledTimes(1);
    const [logObj, msg] = info.mock.calls[0]!;
    expect(logObj).toMatchObject({
      prId: 'pr-1',
      model: expect.any(String),
      provider: expect.any(String),
      tokensIn: expect.any(Number),
      tokensOut: expect.any(Number),
      inputChars: expect.any(Number),
      estBriefTokens: expect.any(Number),
    });
    expect(String(msg)).toMatch(/brief/i);
    expect(metrics.model).toBeTruthy();

    // the card/caller-facing `brief` never carries provenance fields (AC-14)
    expect(brief).not.toHaveProperty('model');
    expect(brief).not.toHaveProperty('tokensIn');
    expect(brief).not.toHaveProperty('inputChars');
    expect(Object.keys(brief).sort()).toEqual(['review_focus', 'risk_level', 'risks', 'what', 'why'].sort());
  });
});
