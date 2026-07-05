import type { SmartDiff, SmartDiffFile, SmartDiffGroup, SmartDiffRole } from '@devdigest/shared';
import {
  BOILERPLATE_PATTERNS,
  SPLIT_MIN_CORE_DIRS,
  SPLIT_TOO_BIG_LINES,
  WIRING_PATTERNS,
} from './constants.js';

/**
 * Pure domain helpers for Smart Diff (no I/O — unit-testable in isolation).
 * `service.ts` is the only caller; it supplies the already-persisted
 * `PrFile`/`Finding` data and gets back the composed `SmartDiff` contract.
 * No LLM call happens anywhere in this file.
 */

/**
 * Classify a single file path by review risk. Precedence matters:
 * `boilerplate` is checked BEFORE `wiring` so e.g. `dist/index.js` (a
 * generated-output-dir match) is `boilerplate`, not `wiring`'s `index.*` rule.
 * Path-only — the patch is not needed for classification.
 */
export function classifyFile(path: string): SmartDiffRole {
  if (BOILERPLATE_PATTERNS.some((re) => re.test(path))) return 'boilerplate';
  if (WIRING_PATTERNS.some((re) => re.test(path))) return 'wiring';
  return 'core';
}

export interface FindingLineInput {
  file: string;
  start_line: number;
}

/**
 * Deduped, ascending-sorted `start_line`s of every finding on `path`.
 * Anchors on `start_line` only (not the `start_line..end_line` range) so the
 * badge count = distinct flagged lines, not raw finding count.
 */
export function findingLinesFor(path: string, findings: FindingLineInput[]): number[] {
  const lines = new Set<number>();
  for (const f of findings) {
    if (f.file === path) lines.add(f.start_line);
  }
  return [...lines].sort((a, b) => a - b);
}

export interface SplitSuggestionFileInput {
  path: string;
}

export interface SplitSuggestion {
  too_big: boolean;
  total_lines: number;
  proposed_splits: { name: string; files: string[] }[];
}

/** First path segment before `/`, or `'(root)'` when the path has no `/`. */
function topLevelDir(path: string): string {
  const slash = path.indexOf('/');
  return slash === -1 ? '(root)' : path.slice(0, slash);
}

export interface SplitFileInput {
  path: string;
  additions: number;
  deletions: number;
}

/**
 * `too_big` when the total changed lines across ALL files exceeds the
 * threshold AND there are at least `SPLIT_MIN_CORE_DIRS` distinct top-level
 * dirs among the CORE files. When `too_big`, propose one split per core dir
 * (sorted dir names, sorted file paths within each).
 */
export function computeSplitSuggestion(
  files: SplitFileInput[],
  coreFiles: SplitSuggestionFileInput[],
): SplitSuggestion {
  const total_lines = files.reduce((sum, f) => sum + f.additions + f.deletions, 0);

  const filesByDir = new Map<string, string[]>();
  for (const f of coreFiles) {
    const dir = topLevelDir(f.path);
    const bucket = filesByDir.get(dir);
    if (bucket) bucket.push(f.path);
    else filesByDir.set(dir, [f.path]);
  }

  const too_big = total_lines > SPLIT_TOO_BIG_LINES && filesByDir.size >= SPLIT_MIN_CORE_DIRS;

  const proposed_splits = too_big
    ? [...filesByDir.entries()]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([name, paths]) => ({ name, files: [...paths].sort() }))
    : [];

  return { too_big, total_lines, proposed_splits };
}

export interface BuildSmartDiffFileInput {
  path: string;
  additions: number;
  deletions: number;
}

/**
 * Compose the persisted `PrFile` projections + `Finding` overlay into the
 * `SmartDiff` contract. Always emits exactly three groups, in fixed order
 * `[core, wiring, boilerplate]` (a group may have an empty `files` array —
 * the client hides empties, but a stable 3-group shape keeps ordering
 * deterministic and the response self-describing). Within each group, files
 * keep the input order (GitHub's diff order) — only the grouping changes the
 * reviewer's reading order.
 */
export function buildSmartDiff(
  files: BuildSmartDiffFileInput[],
  findings: FindingLineInput[],
): SmartDiff {
  const byRole = new Map<SmartDiffRole, SmartDiffFile[]>([
    ['core', []],
    ['wiring', []],
    ['boilerplate', []],
  ]);

  for (const file of files) {
    const role = classifyFile(file.path);
    byRole.get(role)!.push({
      path: file.path,
      pseudocode_summary: null,
      additions: file.additions,
      deletions: file.deletions,
      finding_lines: findingLinesFor(file.path, findings),
    });
  }

  const groups: SmartDiffGroup[] = (['core', 'wiring', 'boilerplate'] as const).map((role) => ({
    role,
    files: byRole.get(role)!,
  }));

  const coreFiles = byRole.get('core')!.map((f) => ({ path: f.path }));
  const split_suggestion = computeSplitSuggestion(files, coreFiles);

  return { groups, split_suggestion };
}
