import type { BlastRadius } from "./types";

export interface BlastStats {
  symbols: number;
  callers: number;
  endpoints: number;
  crons: number;
}

/** Aggregate counts for the header stats line. Endpoints/crons are de-duped
 *  across all downstream entries (the same endpoint/cron can be reachable from
 *  more than one changed symbol). */
export function computeBlastStats(blast: BlastRadius): BlastStats {
  const endpoints = new Set<string>();
  const crons = new Set<string>();
  let callers = 0;
  for (const d of blast.downstream) {
    callers += d.callers.length;
    for (const e of d.endpoints_affected) endpoints.add(e);
    for (const c of d.crons_affected) crons.add(c);
  }
  return {
    symbols: blast.changed_symbols.length,
    callers,
    endpoints: endpoints.size,
    crons: crons.size,
  };
}
