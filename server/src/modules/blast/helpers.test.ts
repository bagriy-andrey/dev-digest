import { describe, it, expect } from 'vitest';
import { BlastRadius } from '@devdigest/shared';
import { toBlastRadius, EMPTY_BLAST_RADIUS } from './helpers.js';
import type { BlastResult } from '../repo-intel/types.js';

describe('toBlastRadius', () => {
  it('groups callers by viaSymbol into per-symbol downstream entries', () => {
    const result: BlastResult = {
      changedSymbols: [
        { file: 'src/rate-limit.ts', name: 'rateLimit', kind: 'function' },
        { file: 'src/rate-limit.ts', name: 'bucketKey', kind: 'function' },
      ],
      callers: [
        { file: 'src/api/index.ts', symbol: 'handler', viaSymbol: 'rateLimit', line: 23, rank: 5 },
        { file: 'src/api/webhooks.ts', symbol: 'webhook', viaSymbol: 'rateLimit', line: 45, rank: 3 },
        { file: 'src/api/health.ts', symbol: 'health', viaSymbol: 'bucketKey', line: 11, rank: 1 },
      ],
      impactedEndpoints: ['GET /api/items'],
      endpointsBySymbol: { rateLimit: ['GET /api/items'], bucketKey: [] },
      cronsBySymbol: { rateLimit: ['reset-rate-buckets'], bucketKey: [] },
      degraded: false,
    };

    const radius = toBlastRadius(result);

    expect(radius.changed_symbols).toEqual([
      { name: 'rateLimit', file: 'src/rate-limit.ts', kind: 'function' },
      { name: 'bucketKey', file: 'src/rate-limit.ts', kind: 'function' },
    ]);
    expect(radius.downstream).toHaveLength(2);

    const rateLimit = radius.downstream.find((d) => d.symbol === 'rateLimit')!;
    expect(rateLimit.callers).toEqual([
      { name: 'handler', file: 'src/api/index.ts', line: 23 },
      { name: 'webhook', file: 'src/api/webhooks.ts', line: 45 },
    ]);
    expect(rateLimit.endpoints_affected).toEqual(['GET /api/items']);
    expect(rateLimit.crons_affected).toEqual(['reset-rate-buckets']);

    const bucketKey = radius.downstream.find((d) => d.symbol === 'bucketKey')!;
    expect(bucketKey.callers).toEqual([{ name: 'health', file: 'src/api/health.ts', line: 11 }]);
    expect(bucketKey.endpoints_affected).toEqual([]);
    expect(bucketKey.crons_affected).toEqual([]);
  });

  it('a symbol with zero callers still gets a downstream entry with empty arrays (not omitted)', () => {
    const result: BlastResult = {
      changedSymbols: [{ file: 'src/quiet.ts', name: 'quiet', kind: 'function' }],
      callers: [],
      impactedEndpoints: [],
      degraded: false,
    };

    const radius = toBlastRadius(result);

    expect(radius.downstream).toHaveLength(1);
    expect(radius.downstream[0]).toEqual({
      symbol: 'quiet',
      callers: [],
      endpoints_affected: [],
      crons_affected: [],
    });
  });

  it('falls back to [] for endpoints/crons when endpointsBySymbol/cronsBySymbol are absent (degraded/fallback BlastResult)', () => {
    const result: BlastResult = {
      changedSymbols: [{ file: 'src/x.ts', name: 'x', kind: 'function' }],
      callers: [{ file: 'src/caller.ts', symbol: 'c', viaSymbol: 'x', line: 1, rank: 0 }],
      impactedEndpoints: [],
      degraded: true,
      reason: 'no_data',
    };

    const radius = toBlastRadius(result);

    expect(radius.downstream[0]!.endpoints_affected).toEqual([]);
    expect(radius.downstream[0]!.crons_affected).toEqual([]);
  });

  it('summary is always an empty string from this pure mapper', () => {
    const result: BlastResult = { changedSymbols: [], callers: [], impactedEndpoints: [], degraded: false };
    expect(toBlastRadius(result).summary).toBe('');
  });

  it('EMPTY_BLAST_RADIUS round-trips through BlastRadius.parse cleanly', () => {
    expect(() => BlastRadius.parse(EMPTY_BLAST_RADIUS)).not.toThrow();
    expect(EMPTY_BLAST_RADIUS).toEqual({
      changed_symbols: [],
      downstream: [],
      prior_prs: [],
      summary: '',
    });
  });

  it('toBlastRadius never fabricates prior_prs — always [] from this pure mapper', () => {
    const result: BlastResult = {
      changedSymbols: [{ file: 'src/x.ts', name: 'x', kind: 'function' }],
      callers: [],
      impactedEndpoints: [],
      degraded: false,
    };
    expect(toBlastRadius(result).prior_prs).toEqual([]);
  });

  it('the output of toBlastRadius always validates against the BlastRadius schema', () => {
    const result: BlastResult = {
      changedSymbols: [{ file: 'a.ts', name: 'fn', kind: 'function' }],
      callers: [{ file: 'b.ts', symbol: 'caller', viaSymbol: 'fn', line: 4, rank: 2 }],
      impactedEndpoints: ['GET /x'],
      endpointsBySymbol: { fn: ['GET /x'] },
      cronsBySymbol: { fn: [] },
      degraded: false,
    };
    expect(() => BlastRadius.parse(toBlastRadius(result))).not.toThrow();
  });
});
