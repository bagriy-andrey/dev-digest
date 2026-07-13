import { describe, it, expect } from 'vitest';
import { applyUnifiedPatch } from '../src/adapters/codeindex/patch-apply.js';

describe('applyUnifiedPatch', () => {
  // Real fixture: bagriy-andrey/ai-stock-app market-movers.controller.ts, `main` (base) vs.
  // the PR #5 (`update-api`) branch — both fetched live via the GitHub API, and the real
  // GitHub-computed patch between them (same text used in extract.test.ts's fixture).
  const BASE_CONTENT =
    'import { Controller, Get, UseGuards } from "@nestjs/common";\n' +
    'import type { MarketMoversResponse } from "@ai-stock-advisor/shared";\n' +
    'import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";\n' +
    'import { MarketDataService } from "./market-data.service";\n' +
    '\n' +
    '@Controller("market/movers")\n' +
    '@UseGuards(JwtAuthGuard)\n' +
    'export class MarketMoversController {\n' +
    '  constructor(private readonly marketDataService: MarketDataService) {}\n' +
    '\n' +
    '  @Get()\n' +
    '  getMarketMovers(): Promise<MarketMoversResponse> {\n' +
    '    return this.marketDataService.getMarketMovers();\n' +
    '  }\n' +
    '}';

  const EXPECTED_PR_CONTENT =
    'import { Controller, Get, Query, UseGuards } from "@nestjs/common";\n' +
    'import type { MarketMoversResponse } from "@ai-stock-advisor/shared";\n' +
    'import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";\n' +
    'import { ListLimitQueryDto } from "../common/dto/list-limit-query.dto";\n' +
    'import { MarketDataService } from "./market-data.service";\n' +
    '\n' +
    '@Controller("market/movers")\n' +
    '@UseGuards(JwtAuthGuard)\n' +
    'export class MarketMoversController {\n' +
    '  constructor(private readonly marketDataService: MarketDataService) {}\n' +
    '\n' +
    '  @Get()\n' +
    '  getMarketMovers(\n' +
    '    @Query() query: ListLimitQueryDto,\n' +
    '  ): Promise<MarketMoversResponse> {\n' +
    '    return this.marketDataService.getMarketMovers(query.limit);\n' +
    '  }\n' +
    '}';

  const REAL_PATCH =
    '@@ -1,6 +1,7 @@\n' +
    '-import { Controller, Get, UseGuards } from "@nestjs/common";\n' +
    '+import { Controller, Get, Query, UseGuards } from "@nestjs/common";\n' +
    ' import type { MarketMoversResponse } from "@ai-stock-advisor/shared";\n' +
    ' import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";\n' +
    '+import { ListLimitQueryDto } from "../common/dto/list-limit-query.dto";\n' +
    ' import { MarketDataService } from "./market-data.service";\n' +
    ' \n' +
    ' @Controller("market/movers")\n' +
    '@@ -9,7 +10,9 @@ export class MarketMoversController {\n' +
    '   constructor(private readonly marketDataService: MarketDataService) {}\n' +
    ' \n' +
    '   @Get()\n' +
    '-  getMarketMovers(): Promise<MarketMoversResponse> {\n' +
    '-    return this.marketDataService.getMarketMovers();\n' +
    '+  getMarketMovers(\n' +
    '+    @Query() query: ListLimitQueryDto,\n' +
    '+  ): Promise<MarketMoversResponse> {\n' +
    '+    return this.marketDataService.getMarketMovers(query.limit);\n' +
    '   }\n' +
    ' }';

  it('reconstructs the real PR-branch content from the real GitHub patch (fetched live fixture)', () => {
    expect(applyUnifiedPatch(BASE_CONTENT, REAL_PATCH)).toBe(EXPECTED_PR_CONTENT);
  });

  it('handles a single-hunk patch with only additions', () => {
    const base = 'a\nb\nc';
    const patch = '@@ -1,3 +1,4 @@\n a\n+x\n b\n c';
    expect(applyUnifiedPatch(base, patch)).toBe('a\nx\nb\nc');
  });

  it('returns null when a context line does not match the base (diverged base)', () => {
    const base = 'a\nDIFFERENT\nc';
    const patch = '@@ -1,3 +1,4 @@\n a\n+x\n b\n c';
    expect(applyUnifiedPatch(base, patch)).toBeNull();
  });

  it('returns null when a removal line does not match the base', () => {
    const base = 'a\nb\nc';
    const patch = '@@ -1,3 +1,2 @@\n a\n-NOT_IN_BASE\n c';
    expect(applyUnifiedPatch(base, patch)).toBeNull();
  });

  it('preserves untouched lines before and after all hunks', () => {
    const base = 'head\na\nb\ntail';
    const patch = '@@ -2,2 +2,3 @@\n a\n+x\n b';
    expect(applyUnifiedPatch(base, patch)).toBe('head\na\nx\nb\ntail');
  });
});
