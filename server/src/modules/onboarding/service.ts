import { join } from 'node:path';
import { Onboarding, type OnboardingDoc, type OnboardingSection } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { wrapUntrusted } from '../../platform/prompt.js';
import { renderPrompt } from '../../platform/prompts.js';
import { resolveFeatureModel } from '../settings/feature-models.js';
import { RepoRepository } from '../repos/repository.js';
import { OnboardingRepository } from './repository.js';
import {
  ONBOARDING_SECTIONS,
  MANIFEST_FILE_FAMILIES,
  MAX_MANIFEST_LINES,
  DEGRADED_SECTION_BODY,
  readFileIfExists,
  type OnboardingSectionSpec,
} from './constants.js';

/** How many top-ranked files feed the Reading Path section (AC-3). */
const READING_PATH_TOP_N = 20;

/** Minimal pino-compatible logger, same shape used by `ContextService`/`IntentService`. */
export type Logger = {
  info: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
};

export interface ManifestFacts {
  /** Rendered `### filename\n\`\`\`\n<content>\n\`\`\`` blocks, joined. */
  text: string;
  /** Exact filenames actually read (first-variant-wins per family). */
  filesUsed: string[];
}

/**
 * Read the fixed manifest allowlist from the clone (AC-1 — never a full
 * file-tree walk). First existing variant per family wins (decision C).
 * Exported for hermetic unit testing against a real temp dir.
 */
export async function gatherManifestFacts(clonePath: string): Promise<ManifestFacts> {
  const parts: string[] = [];
  const filesUsed: string[] = [];
  for (const family of MANIFEST_FILE_FAMILIES) {
    for (const filename of family) {
      const content = await readFileIfExists(join(clonePath, filename), MAX_MANIFEST_LINES);
      if (content) {
        parts.push(`### ${filename}\n\`\`\`\n${content}\n\`\`\``);
        filesUsed.push(filename);
        break; // first-variant-wins within this family
      }
    }
  }
  return { text: parts.join('\n\n'), filesUsed };
}

/** Render the ordered, titled `{{sections}}` prompt variable. */
export function renderSectionsVar(specs: OnboardingSectionSpec[] = ONBOARDING_SECTIONS): string {
  return specs.map((s) => `${s.kind} (${s.title})`).join(', ');
}

/** Render Reading Path facts (AC-3 — rank-order only, never alphabetical/date/hotness). */
export function renderReadingPathFacts(topFiles: string[], criticalPaths: string[][]): string {
  const lines: string[] = [];
  if (topFiles.length > 0) {
    lines.push('Top-ranked files (import-graph rank order):');
    topFiles.forEach((f, i) => lines.push(`${i + 1}. ${f}`));
  }
  if (criticalPaths.length > 0) {
    if (lines.length > 0) lines.push('');
    lines.push('Critical dependency paths:');
    criticalPaths.forEach((chain, i) => lines.push(`${i + 1}. ${chain.join(' -> ')}`));
  }
  return lines.join('\n');
}

/** Render Routes & APIs facts (AC-4). */
export function renderRoutesFacts(endpoints: string[]): string {
  return endpoints.join('\n');
}

/**
 * Union of every path present in this generation's gathered facts — the
 * AC-9 hallucination backstop validates `links[].path` against this set.
 * The repo-map text is a formatted skeleton, not a clean list, so path-like
 * tokens (containing a `.` extension) are extracted best-effort.
 */
export function buildKnownPaths(opts: {
  manifestFiles: string[];
  repoMapText: string;
  topFiles: string[];
  criticalPaths: string[][];
}): Set<string> {
  const set = new Set<string>();
  for (const f of opts.manifestFiles) set.add(f);
  for (const f of opts.topFiles) set.add(f);
  for (const chain of opts.criticalPaths) for (const f of chain) set.add(f);
  const pathLike = opts.repoMapText.match(/[\w.\-/]+\.[A-Za-z0-9]+/g) ?? [];
  for (const p of pathLike) set.add(p.trim());
  return set;
}

/**
 * Coerce the LLM's sections to exactly the 5 `ONBOARDING_SECTIONS`, in fixed
 * order (AC-6/AC-16), matched by `kind` first and falling back to position if
 * the model reordered/renamed a section; canonical `title` always wins.
 * Also enforces AC-8 (diagram only on `architecture`/`routes_and_apis`).
 */
export function coerceSections(
  modelSections: OnboardingSection[],
  specs: OnboardingSectionSpec[] = ONBOARDING_SECTIONS,
): OnboardingSection[] {
  return specs.map((spec, i) => {
    const byKind = modelSections.find((s) => s.kind === spec.kind);
    const source = byKind ?? modelSections[i];
    return {
      kind: spec.kind,
      title: spec.title,
      body: source?.body ?? '',
      diagram: spec.diagramAllowed ? (source?.diagram ?? null) : null,
      links: source?.links ? [...source.links] : [],
    };
  });
}

/** AC-9 — drop any `links[].path` not present in this generation's gathered facts. */
export function filterHallucinatedLinks(
  sections: OnboardingSection[],
  knownPaths: Set<string>,
): OnboardingSection[] {
  return sections.map((s) => ({ ...s, links: s.links.filter((l) => knownPaths.has(l.path)) }));
}

const DEGRADED_KINDS = new Set(['architecture', 'routes_and_apis', 'reading_path']);

/**
 * AC-5 — when the repo-intel index is degraded/disabled, overwrite the three
 * facade-derived sections with an explicit degraded marker regardless of what
 * the LLM produced (a code backstop, not a prompt instruction). Tech Stack and
 * First Tasks are untouched — they don't depend on the facade.
 */
export function applyDegradedBackstop(
  sections: OnboardingSection[],
  degraded: boolean,
): OnboardingSection[] {
  if (!degraded) return sections;
  return sections.map((s) =>
    DEGRADED_KINDS.has(s.kind) ? { ...s, body: DEGRADED_SECTION_BODY, diagram: null, links: [] } : s,
  );
}

/** AC-11 — `costUsd` (dollars) → integer cents; `null` stays `null`. */
export function costUsdToCents(costUsd: number | null): number | null {
  return costUsd == null ? null : Math.round(costUsd * 100);
}

/**
 * `OnboardingService(container)` — the Onboarding generator module (SPEC-01
 * onboarding-generator). Constructor mirrors `ConventionsService`: builds its
 * own `OnboardingRepository`/`RepoRepository` from `container.db` rather than
 * taking them as constructor params.
 */
export class OnboardingService {
  private repo: OnboardingRepository;
  private repos: RepoRepository;

  constructor(private container: Container) {
    this.repo = new OnboardingRepository(container.db);
    this.repos = new RepoRepository(container.db);
  }

  /** AC-17/AC-18: always 200 with a possibly-null doc, never a 404. */
  async get(repoId: string): Promise<OnboardingDoc> {
    const row = await this.repo.get(repoId);
    return this.repo.toDoc(row);
  }

  /**
   * Generate (first time) / Regenerate (any time) the onboarding tour — the
   * full pipeline: fact gathering (AC-1–AC-4) → ONE structured LLM call
   * (AC-6/AC-7) → deterministic post-processing (AC-5/AC-8/AC-9) → persist
   * (AC-11/AC-12/AC-13). On failure, the persisted row is left untouched and
   * the error propagates to the caller (AC-10).
   */
  async generate(workspaceId: string, repoId: string, log?: Logger): Promise<OnboardingDoc> {
    const repoRow = await this.repos.getById(workspaceId, repoId);
    if (!repoRow?.clonePath) {
      throw new Error('Repository is not cloned yet. Please wait for indexing to complete.');
    }
    const clonePath = repoRow.clonePath;

    const state = await this.container.repoIntel.getIndexState(repoId);
    const degraded = state.degraded === true || !this.container.config.repoIntelEnabled;

    try {
      // ---- Fact gathering (deterministic, AC-1–AC-4) ------------------------
      const manifest = await gatherManifestFacts(clonePath);
      const repoMap = await this.container.repoIntel.getRepoMap(repoId);
      const [topFiles, criticalPaths, endpoints] = await Promise.all([
        this.container.repoIntel.getTopFilesByRank(repoId, READING_PATH_TOP_N),
        this.container.repoIntel.getCriticalPaths(repoId),
        this.container.repoIntel.getRepoEndpoints(repoId),
      ]);

      const readingPathText = renderReadingPathFacts(topFiles, criticalPaths);
      const routesText = renderRoutesFacts(endpoints);

      const userSections: string[] = [];
      if (manifest.text) {
        userSections.push(`## Tech Stack facts\n${wrapUntrusted('manifest', manifest.text)}`);
      }
      if (repoMap.text) {
        userSections.push(`## Architecture facts\n${wrapUntrusted('repo-map', repoMap.text)}`);
      }
      if (readingPathText) {
        userSections.push(
          `## Reading Path facts\n${wrapUntrusted('reading-path', readingPathText)}`,
        );
      }
      if (routesText) {
        userSections.push(`## Routes & APIs facts\n${wrapUntrusted('routes', routesText)}`);
      }

      // ---- ONE structured LLM call (AC-6/AC-7) ------------------------------
      const system = await renderPrompt('onboarding.system.md', {
        sections: renderSectionsVar(ONBOARDING_SECTIONS),
        language: 'English',
      });

      const { provider, model } = await resolveFeatureModel(
        this.container,
        workspaceId,
        'onboarding',
      );
      const llm = await this.container.llm(provider as 'openai' | 'anthropic' | 'openrouter');

      const result = await llm.completeStructured({
        model,
        schema: Onboarding,
        schemaName: 'onboarding',
        temperature: 0.1,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: userSections.join('\n\n') || 'No facts were gathered for this repo.' },
        ],
      });

      // ---- Deterministic post-processing (AC-5/AC-8/AC-9) -------------------
      const knownPaths = buildKnownPaths({
        manifestFiles: manifest.filesUsed,
        repoMapText: repoMap.text,
        topFiles,
        criticalPaths,
      });

      let sections = coerceSections(result.data.sections);
      sections = filterHallucinatedLinks(sections, knownPaths);
      sections = applyDegradedBackstop(sections, degraded);

      const costCents = costUsdToCents(result.costUsd);

      log?.info(
        {
          tokensIn: result.tokensIn,
          tokensOut: result.tokensOut,
          costCents,
          sourceSha: state.lastIndexedSha,
          ok: true,
        },
        'onboarding generation succeeded',
      );

      // ---- Persist (AC-11/AC-12/AC-13 — reads the current index only) -------
      await this.repo.upsert(repoId, {
        json: { sections },
        sourceSha: state.lastIndexedSha,
        costCents,
      });

      const written = await this.repo.get(repoId);
      return this.repo.toDoc(written);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      log?.error({ reason, sourceSha: state.lastIndexedSha, ok: false }, 'onboarding generation failed');
      throw err;
    }
  }
}
