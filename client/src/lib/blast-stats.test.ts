import { describe, expect, it } from "vitest";
import { computeBlastStats } from "./blast-stats";
import type { BlastRadius } from "./types";

type ChangedSymbol = BlastRadius["changed_symbols"][number];
type DownstreamImpact = BlastRadius["downstream"][number];

function symbol(name: string): ChangedSymbol {
  return { name, file: `src/${name}.ts`, kind: "function" };
}

function downstream(
  symbol_: string,
  callerCount: number,
  endpoints: string[],
  crons: string[],
): DownstreamImpact {
  return {
    symbol: symbol_,
    callers: Array.from({ length: callerCount }, (_, i) => ({
      name: `caller${i}`,
      file: `src/caller${i}.ts`,
      line: i + 1,
    })),
    endpoints_affected: endpoints,
    crons_affected: crons,
  };
}

function blast(
  changed_symbols: ChangedSymbol[],
  downstreamEntries: DownstreamImpact[],
): BlastRadius {
  return { changed_symbols, downstream: downstreamEntries, prior_prs: [], summary: "" };
}

describe("computeBlastStats", () => {
  it("returns all-zero stats for an empty blast radius", () => {
    expect(computeBlastStats(blast([], []))).toEqual({
      symbols: 0,
      callers: 0,
      endpoints: 0,
      crons: 0,
    });
  });

  it("sums callers across multiple downstream entries", () => {
    const b = blast(
      [symbol("a"), symbol("b")],
      [downstream("a", 2, [], []), downstream("b", 3, [], [])],
    );
    expect(computeBlastStats(b).callers).toBe(5);
  });

  it("de-dupes endpoints appearing under two different changed symbols", () => {
    const b = blast(
      [symbol("a"), symbol("b")],
      [
        downstream("a", 0, ["/api/foo"], []),
        downstream("b", 0, ["/api/foo"], []),
      ],
    );
    expect(computeBlastStats(b).endpoints).toBe(1);
  });

  it("de-dupes crons appearing under two different changed symbols", () => {
    const b = blast(
      [symbol("a"), symbol("b")],
      [downstream("a", 0, [], ["nightly-sync"]), downstream("b", 0, [], ["nightly-sync"])],
    );
    expect(computeBlastStats(b).crons).toBe(1);
  });

  it("counts distinct endpoints/crons separately when they differ", () => {
    const b = blast(
      [symbol("a"), symbol("b")],
      [
        downstream("a", 0, ["/api/foo"], ["nightly-sync"]),
        downstream("b", 0, ["/api/bar"], ["hourly-cleanup"]),
      ],
    );
    const stats = computeBlastStats(b);
    expect(stats.endpoints).toBe(2);
    expect(stats.crons).toBe(2);
  });

  it.each([
    { count: 0, symbols: [] as ChangedSymbol[] },
    { count: 1, symbols: [symbol("a")] },
    { count: 2, symbols: [symbol("a"), symbol("b")] },
  ])("reports $count for $count changed symbol(s)", ({ count, symbols }) => {
    expect(computeBlastStats(blast(symbols, [])).symbols).toBe(count);
  });

  it.each([
    { count: 0, callerCounts: [] as number[] },
    { count: 1, callerCounts: [1] },
    { count: 2, callerCounts: [1, 1] },
  ])("reports $count for $count caller(s)", ({ count, callerCounts }) => {
    const downstreamEntries = callerCounts.map((n, i) => downstream(`s${i}`, n, [], []));
    expect(computeBlastStats(blast([], downstreamEntries)).callers).toBe(count);
  });

  it.each([
    { count: 0, endpointSets: [] as string[][] },
    { count: 1, endpointSets: [["/api/foo"]] },
    { count: 2, endpointSets: [["/api/foo"], ["/api/bar"]] },
  ])("reports $count for $count unique endpoint(s)", ({ count, endpointSets }) => {
    const downstreamEntries = endpointSets.map((e, i) => downstream(`s${i}`, 0, e, []));
    expect(computeBlastStats(blast([], downstreamEntries)).endpoints).toBe(count);
  });

  it.each([
    { count: 0, cronSets: [] as string[][] },
    { count: 1, cronSets: [["nightly-sync"]] },
    { count: 2, cronSets: [["nightly-sync"], ["hourly-cleanup"]] },
  ])("reports $count for $count unique cron(s)", ({ count, cronSets }) => {
    const downstreamEntries = cronSets.map((c, i) => downstream(`s${i}`, 0, [], c));
    expect(computeBlastStats(blast([], downstreamEntries)).crons).toBe(count);
  });
});
