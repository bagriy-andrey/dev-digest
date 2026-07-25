import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Project Context discovery (SPEC-01) — pure, hermetically testable, no DB and
 * no I/O beyond reading the given clone directory on disk.
 *
 * Uses Node 22's `fs.readdir({ recursive: true, withFileTypes: true })`
 * (stable since Node 20.1 / typed `Dirent.parentPath` since @types/node 22) —
 * deliberately NOT a glob dependency; none exists in this package's deps.
 */

/** One discovered `.md` doc, before any DB-backed metrics are attached. */
export interface DiscoveredDoc {
  /** Repo-relative path, POSIX separators. */
  path: string;
  /** The folder name (from `folders`) this doc was found under. */
  source_type: string;
  /** Byte size of the file content. */
  size: number;
  /** Count of ATX (`#`…`######`) markdown heading lines. */
  headings: number;
}

const HEADING_RE = /^#{1,6}\s/;

/** Directory names never descended into for doc purposes (hygiene, not a hard security boundary). */
const SKIP_SEGMENTS = new Set(['node_modules', '.git']);

/**
 * Discover every `.md` file under any path segment named one of `folders`
 * (at any depth) inside `cloneBasePath`. Returns `[]` when the directory is
 * missing/unreadable — discovery degrades gracefully, it never throws for a
 * repo that hasn't been cloned yet.
 */
export async function discoverDocs(
  cloneBasePath: string,
  folders: readonly string[],
): Promise<DiscoveredDoc[]> {
  const folderSet = new Set(folders);
  if (folderSet.size === 0) return [];

  const base = path.resolve(cloneBasePath);

  let entries;
  try {
    entries = await readdir(base, { recursive: true, withFileTypes: true });
  } catch {
    return [];
  }

  const docs: DiscoveredDoc[] = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.md')) continue;

    const parentDir = entry.parentPath ?? base;
    const fullPath = path.resolve(parentDir, entry.name);

    // Path-safety: reject anything that resolves outside the clone root.
    // Defense in depth — readdir(base, {recursive:true}) already stays inside
    // `base` for a normal tree, but never trust a resolved path without
    // verifying it, in case of symlinks or a future refactor of this walk.
    const rel = path.relative(base, fullPath);
    if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) continue;

    const segments = rel.split(path.sep);
    if (segments.some((s) => SKIP_SEGMENTS.has(s))) continue;

    const sourceType = segments.find((s) => folderSet.has(s));
    if (!sourceType) continue;

    let content: string;
    try {
      content = await readFile(fullPath, 'utf8');
    } catch {
      // Unreadable (permissions/race with a concurrent resync) — skip this
      // one file rather than failing the whole scan.
      continue;
    }

    const headings = content.split('\n').filter((line) => HEADING_RE.test(line)).length;

    docs.push({
      path: segments.join('/'),
      source_type: sourceType,
      size: Buffer.byteLength(content, 'utf8'),
      headings,
    });
  }

  return docs;
}
