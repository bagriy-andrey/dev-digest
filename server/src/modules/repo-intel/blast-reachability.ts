/**
 * Pure reverse-import-graph reachability walk for Blast Radius' 2-hop
 * endpoint/cron attribution. No I/O — the caller supplies the already-fetched
 * `edges` (one `getEdges` read), so this is hermetically unit-testable
 * without Postgres.
 *
 * The `fileEdges` schema comment (`db/schema/repo-intel.ts`) documents this
 * as the intended mechanism: "the reverse-lookup index (repoId, toFile) is
 * what blast uses to walk 'who depends on this file?'" — this module IS that
 * walk, generalized to N seeds and a bounded depth/visited cap.
 */

export interface FileEdge {
  fromFile: string;
  toFile: string;
}

/**
 * For each seed file, the set of files that TRANSITIVELY IMPORT it within
 * `depth` hops. `edges` are `fromFile imports toFile`, so reachability walks
 * `toFile -> fromFile` (reverse). The seed itself is never included in its
 * own result (also holds under an import cycle). Deterministic, insertion-
 * ordered. `cap` bounds the reachable-set size PER SEED (not shared across
 * seeds) — one indexed read's worth of fan-out, not a repo-wide walk.
 */
export function reverseReachableFiles(
  edges: FileEdge[],
  seeds: string[],
  depth: number,
  cap: number,
): Map<string, Set<string>> {
  const importedBy = new Map<string, string[]>();
  for (const e of edges) {
    const arr = importedBy.get(e.toFile);
    if (arr) arr.push(e.fromFile);
    else importedBy.set(e.toFile, [e.fromFile]);
  }

  const result = new Map<string, Set<string>>();

  for (const seed of seeds) {
    const reachable = new Set<string>();
    const visited = new Set<string>([seed]);
    let frontier = [seed];

    for (let hop = 0; hop < depth && frontier.length > 0 && reachable.size < cap; hop += 1) {
      const next: string[] = [];
      for (const f of frontier) {
        for (const importer of importedBy.get(f) ?? []) {
          if (visited.has(importer)) continue;
          visited.add(importer);
          reachable.add(importer);
          next.push(importer);
          if (reachable.size >= cap) break;
        }
        if (reachable.size >= cap) break;
      }
      frontier = next;
    }

    result.set(seed, reachable);
  }

  return result;
}
