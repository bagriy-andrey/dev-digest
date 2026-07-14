/**
 * Applies a GitHub-style unified-diff patch (one file's hunks) to that file's PRE-patch content,
 * producing the POST-patch content — pure, no I/O. Used by Blast Radius (Phase 2, `server/specs/
 * blast-radius-pr-branch-symbols.md`) to reconstruct a MODIFIED file's real PR-branch content
 * from `pr_files.patch` + the currently-indexed (default-branch) content, so the existing
 * `extractReferences` scanner can find call sites that exist only within the PR's own diff.
 *
 * Deliberately separate from `extract.ts`'s `reconstructAddedFileContent` — that one needs no
 * base content at all (an added file's patch IS the whole file); this one is the general
 * context-verified splice, a different algorithm for a different input shape.
 */

interface Hunk {
  oldStart: number;
  lines: { kind: 'context' | 'remove' | 'add'; text: string }[];
}

const HUNK_HEADER_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

function parseHunks(patch: string): Hunk[] | null {
  const lines = patch.split('\n');
  const hunks: Hunk[] = [];
  let current: Hunk | null = null;

  for (const raw of lines) {
    const header = raw.match(HUNK_HEADER_RE);
    if (header) {
      current = { oldStart: Number(header[1]), lines: [] };
      hunks.push(current);
      continue;
    }
    if (!current) continue; // stray content before the first hunk header
    if (raw.startsWith('\\ No newline at end of file')) continue;
    if (raw.startsWith('+')) current.lines.push({ kind: 'add', text: raw.slice(1) });
    else if (raw.startsWith('-')) current.lines.push({ kind: 'remove', text: raw.slice(1) });
    else if (raw.startsWith(' ')) current.lines.push({ kind: 'context', text: raw.slice(1) });
    else if (raw === '') current.lines.push({ kind: 'context', text: '' });
    else return null; // unrecognized line shape — don't guess
  }
  return hunks.length > 0 ? hunks : null;
}

/**
 * Applies `patch` (a unified diff against `baseContent`) and returns the resulting content, or
 * `null` if any hunk's context/removal lines don't match `baseContent` at the expected position
 * (the base has diverged from what the patch assumes — degrade rather than produce a corrupted
 * reconstruction; see the spec's §5 risk note on base-content divergence).
 */
export function applyUnifiedPatch(baseContent: string, patch: string): string | null {
  const hunks = parseHunks(patch);
  if (!hunks) return null;

  const baseLines = baseContent.split('\n');
  const out: string[] = [];
  let cursor = 0; // next unconsumed 0-indexed base line

  for (const hunk of hunks) {
    const hunkStart = hunk.oldStart - 1; // 0-indexed
    if (hunkStart < cursor || hunkStart > baseLines.length) return null;
    // Untouched gap between the previous hunk (or file start) and this one.
    for (let i = cursor; i < hunkStart; i += 1) out.push(baseLines[i]!);
    cursor = hunkStart;

    for (const line of hunk.lines) {
      if (line.kind === 'add') {
        out.push(line.text);
        continue;
      }
      // context or remove — must match the base at `cursor`.
      if (cursor >= baseLines.length || baseLines[cursor] !== line.text) return null;
      if (line.kind === 'context') out.push(line.text);
      cursor += 1;
    }
  }

  for (let i = cursor; i < baseLines.length; i += 1) out.push(baseLines[i]!);
  return out.join('\n');
}
