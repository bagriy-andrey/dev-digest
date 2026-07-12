import type { BlastRadius } from '@devdigest/shared';
import type { BlastResult } from '../repo-intel/types.js';

/**
 * Pure domain mapper for Blast Radius (no I/O — unit-testable in isolation).
 * `service.ts` is the only caller; it supplies the already-computed
 * `repoIntel.getBlastRadius()` result and gets back the composed
 * `BlastRadius` contract. No LLM call happens anywhere in this file.
 */

/** The "no data" shape — reused for a PR with zero `pr_files` or zero parseable symbols. */
export const EMPTY_BLAST_RADIUS: BlastRadius = {
  changed_symbols: [],
  downstream: [],
  prior_prs: [],
  summary: '',
};

/**
 * Reshape the facade-native `BlastResult` (flat `callers[]` with a `viaSymbol`
 * field) into the `BlastRadius` contract (grouped BY changed symbol). A
 * changed symbol with zero callers still gets a `downstream` entry with empty
 * arrays — never omitted from the list. `endpoints_affected`/`crons_affected`
 * fall back to `[]` when `endpointsBySymbol`/`cronsBySymbol` are absent (the
 * ripgrep/degraded fallback path doesn't populate them — still 1-hop).
 * `summary` is always `''` here; only the optional summarize route ever
 * fills it in, never this deterministic mapper. `prior_prs` is always `[]`
 * here too — this mapper has no PR-history data; `service.ts` overrides it
 * with the real overlap query result.
 */
export function toBlastRadius(result: BlastResult): BlastRadius {
  const changed_symbols = result.changedSymbols.map((s) => ({
    name: s.name,
    file: s.file,
    kind: s.kind,
  }));

  const downstream = changed_symbols.map((cs) => ({
    symbol: cs.name,
    callers: result.callers
      .filter((c) => c.viaSymbol === cs.name)
      .map((c) => ({ name: c.symbol, file: c.file, line: c.line })),
    endpoints_affected: result.endpointsBySymbol?.[cs.name] ?? [],
    crons_affected: result.cronsBySymbol?.[cs.name] ?? [],
  }));

  return { changed_symbols, downstream, prior_prs: [], summary: '' };
}
