import { readFile, access } from 'node:fs/promises';

/**
 * Onboarding generator (SPEC-01) — fixed section spec + manifest allowlist.
 *
 * Mirrors the `conventions` module's `CONFIG_FILE_CANDIDATES` +
 * `readFileIfExists`/`truncate`/`MAX_CONFIG_LINES` style (helpers copied, NOT
 * imported cross-module — onion architecture forbids reaching into another
 * module's folder).
 */

export interface OnboardingSectionSpec {
  kind: string;
  title: string;
  diagramAllowed: boolean;
}

/**
 * Fixed section order (AC-6/AC-8/AC-16). Source of truth for:
 *  - the `{{sections}}` prompt render (ordered titled list),
 *  - which sections may carry a non-null mermaid `diagram` (AC-8),
 *  - the deterministic re-order/coerce backstop applied to the LLM output.
 */
export const ONBOARDING_SECTIONS: OnboardingSectionSpec[] = [
  { kind: 'tech_stack', title: 'Tech Stack', diagramAllowed: false },
  { kind: 'architecture', title: 'Architecture', diagramAllowed: true },
  { kind: 'routes_and_apis', title: 'Routes & APIs', diagramAllowed: true },
  { kind: 'reading_path', title: 'Reading Path', diagramAllowed: false },
  { kind: 'first_tasks', title: 'First Tasks', diagramAllowed: false },
];

/**
 * Manifest allowlist (AC-1, decision C) — a fixed, bounded set of files read
 * directly from the repo clone for Tech Stack facts. NEVER a full file-tree
 * walk.
 */
export const MANIFEST_FILE_CANDIDATES: string[] = [
  'package.json',
  'README.md',
  'README',
  'readme.md',
  'docker-compose.yml',
  'docker-compose.yaml',
  'compose.yml',
  'compose.yaml',
  '.env.example',
  '.env.sample',
];

/**
 * `MANIFEST_FILE_CANDIDATES` grouped into logical "families" — reading stops
 * at the first existing variant per family (AC-1: first-variant-wins), so a
 * repo with both `README.md` and `README` only contributes one Tech Stack
 * fact for "the README", not two duplicated facts.
 */
export const MANIFEST_FILE_FAMILIES: string[][] = [
  ['package.json'],
  ['README.md', 'README', 'readme.md'],
  ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml'],
  ['.env.example', '.env.sample'],
];

/** Bounds each manifest read so one oversized file can't blow up the prompt. */
export const MAX_MANIFEST_LINES = 200;

/** Marker body used to overwrite a section under the AC-5 degraded backstop. */
export const DEGRADED_SECTION_BODY =
  'The repo-intel index for this repo is degraded or disabled, so this section ' +
  'could not be generated from grounded facts. Regenerate once the index is healthy.';

export function truncate(content: string, maxLines: number): string {
  const lines = content.split('\n');
  return lines.length <= maxLines
    ? content
    : lines.slice(0, maxLines).join('\n') + `\n…(${lines.length - maxLines} more lines)`;
}

export async function readFileIfExists(path: string, maxLines: number): Promise<string | null> {
  try {
    await access(path);
    const content = await readFile(path, 'utf8');
    return truncate(content, maxLines);
  } catch {
    return null;
  }
}
