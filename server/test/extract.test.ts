import { describe, it, expect } from 'vitest';
import {
  extractSymbols,
  extractReferences,
  extractEndpoints,
  extractCrons,
  extractNestRoutes,
  isAddedFilePatch,
  reconstructAddedFileContent,
} from '../src/adapters/codeindex/extract.js';

/**
 * A3 — unit tests for the enhanced TS/JS symbol/reference extractor (L04).
 * Pure (no DB/network) — the core of blast-radius accuracy.
 */
describe('extractSymbols', () => {
  it('finds functions, arrows, classes, methods, interfaces, types', () => {
    const src = `
export function rateLimit(req) { return true; }
const helper = (x) => x + 1;
export const compute = async (n: number) => n * 2;
export class Bucket {
  refill(now: number) { return now; }
  static make() { return new Bucket(); }
}
export interface Config { port: number }
export type Id = string;
`;
    const syms = extractSymbols(src);
    const names = syms.map((s) => s.name);
    expect(names).toContain('rateLimit');
    expect(names).toContain('helper');
    expect(names).toContain('compute');
    expect(names).toContain('Bucket');
    expect(names).toContain('refill'); // class method (bare)
    expect(names).toContain('Bucket.refill'); // class method (qualified)
    expect(names).toContain('Config');
    expect(names).toContain('Id');
    expect(syms.find((s) => s.name === 'Bucket')?.kind).toBe('class');
    expect(syms.find((s) => s.name === 'Config')?.kind).toBe('interface');
  });

  it('ignores keywords and comment lines', () => {
    const src = `
// function notReal(x) {}
/* class AlsoNot {} */
if (x) { doThing(); }
`;
    const syms = extractSymbols(src);
    expect(syms.map((s) => s.name)).not.toContain('notReal');
    expect(syms.map((s) => s.name)).not.toContain('AlsoNot');
    expect(syms.map((s) => s.name)).not.toContain('if');
  });
});

describe('extractReferences (downstream callers)', () => {
  it('finds call sites and excludes the declaration', () => {
    const caller = `
import { rateLimit } from './mw';
export function handler(req) {
  if (!rateLimit(req)) return 429;
  return 200;
}
`;
    const refs = extractReferences(caller, 'rateLimit');
    // exactly the call site on the if-line, NOT the import line
    expect(refs.length).toBe(1);
    expect(refs[0]!.line).toBe(4);
  });

  it('matches member calls, new, and JSX usage', () => {
    expect(extractReferences('obj.compute(1)', 'compute').length).toBe(1);
    expect(extractReferences('const b = new Bucket()', 'Bucket').length).toBe(1);
    expect(extractReferences('return <Widget id={1} />', 'Widget').length).toBe(1);
  });

  it('does not count the declaration line as a reference', () => {
    const decl = `export function rateLimit(req) { return true; }`;
    expect(extractReferences(decl, 'rateLimit').length).toBe(0);
  });
});

describe('extractEndpoints / extractCrons', () => {
  it('detects fastify/express route registrations', () => {
    const src = `
app.get('/users', handler);
router.post("/users/:id", update);
app.get<{ Params: { id: string } }>('/pulls/:id/blast', blast);
`;
    const eps = extractEndpoints(src);
    expect(eps).toContain('GET /users');
    expect(eps).toContain('POST /users/:id');
    expect(eps).toContain('GET /pulls/:id/blast');
  });

  it('detects cron expressions and background job kinds', () => {
    const src = `
cron.schedule('*/5 * * * *', poll);
jobs.register('poll_repo', handler);
`;
    const crons = extractCrons(src);
    expect(crons.some((c) => c.includes('*/5'))).toBe(true);
    expect(crons).toContain('job:poll_repo');
  });
});

describe('extractNestRoutes', () => {
  it('joins @Controller prefix with a @Get method path', () => {
    const src = `
@Controller('portfolio')
export class PortfolioController {
  @Get('allocation')
  getAllocation() {
    return this.portfolioService.getAllocationForUser();
  }
}
`;
    const routes = extractNestRoutes(src);
    expect(routes).toEqual([
      expect.objectContaining({ route: 'GET /portfolio/allocation', methodName: 'getAllocation' }),
    ]);
  });

  it('handles a bare @Controller()/@Get() with no path arguments', () => {
    const src = `
@Controller()
export class HealthController {
  @Get()
  check() {
    return { ok: true };
  }
}
`;
    const routes = extractNestRoutes(src);
    expect(routes).toEqual([expect.objectContaining({ route: 'GET /', methodName: 'check' })]);
  });

  it('finds the verb decorator through a stack of other decorators', () => {
    const src = `
@Controller('watchlist')
export class WatchlistController {
  @UseGuards(JwtAuthGuard)
  @Get()
  getWatchlist(@Request() request) {
    return this.watchlistService.findAllForUser();
  }
}
`;
    const routes = extractNestRoutes(src);
    expect(routes).toEqual([
      expect.objectContaining({ route: 'GET /watchlist', methodName: 'getWatchlist' }),
    ]);
  });

  it('only emits routes for decorated methods, skipping constructor and undecorated helpers', () => {
    const src = `
@Controller('market/movers')
export class MarketMoversController {
  constructor(private readonly marketDataService: MarketDataService) {}

  @Get()
  getMarketMovers(@Query() query: ListLimitQueryDto) {
    return this.marketDataService.getMarketMovers(query.limit);
  }

  private helper() {
    return true;
  }
}
`;
    const routes = extractNestRoutes(src);
    expect(routes).toEqual([
      expect.objectContaining({ route: 'GET /market/movers', methodName: 'getMarketMovers' }),
    ]);
  });

  it('emits nothing for a plain class that is not @Controller-decorated', () => {
    const src = `
export class PortfolioService {
  getAllocationForUser() {
    return null;
  }
}
`;
    expect(extractNestRoutes(src)).toEqual([]);
  });

  it('detects a route whose signature spans multiple lines (one decorated param per line)', () => {
    // Real-world shape: constructor AND handler params each on their own line —
    // METHOD_RE alone never matches this (name/open-paren and close-paren/body-brace
    // are on different lines).
    const src = `
@Controller("portfolio")
@UseGuards(JwtAuthGuard)
export class PortfolioController {
  constructor(
    private readonly portfolioService: PortfolioService,
    private readonly portfolioPerformanceService: PortfolioPerformanceService,
  ) {}

  @Get("allocation")
  getAllocation(
    @Request() request: AuthenticatedRequest,
  ): Promise<PortfolioAllocationDto> {
    return this.portfolioService.getAllocationForUser(
      this.getAuthenticatedUserId(request),
    );
  }
}
`;
    const routes = extractNestRoutes(src);
    expect(routes).toEqual([
      expect.objectContaining({ route: 'GET /portfolio/allocation', methodName: 'getAllocation' }),
    ]);
  });

  it('detects multiple routes on the same controller (real-world PR shape)', () => {
    const src = `
@Controller("portfolio")
export class PortfolioController {
  constructor(private readonly portfolioService: PortfolioService) {}

  @Get("allocation")
  getAllocation(@Request() request: AuthenticatedRequest): Promise<PortfolioAllocationDto> {
    return this.portfolioService.getAllocationForUser(getAuthenticatedUserId(request));
  }

  @Get("performance")
  getPerformance(@Request() request: AuthenticatedRequest): Promise<PortfolioPerformancePointDto[]> {
    return this.portfolioPerformanceService.getPerformanceForUser(getAuthenticatedUserId(request));
  }
}
`;
    const routes = extractNestRoutes(src);
    expect(routes).toEqual([
      expect.objectContaining({ route: 'GET /portfolio/allocation', methodName: 'getAllocation' }),
      expect.objectContaining({ route: 'GET /portfolio/performance', methodName: 'getPerformance' }),
    ]);
  });
});

describe('isAddedFilePatch / reconstructAddedFileContent', () => {
  // Real GitHub patch for a brand-new file, apps/api/src/auth/get-authenticated-user-id.ts,
  // from bagriy-andrey/ai-stock-app PR #5 — the exact real-world case this fix closes.
  const ADDED_FILE_PATCH =
    '@@ -0,0 +1,12 @@\n' +
    '+import { UnauthorizedException } from "@nestjs/common";\n' +
    '+import type { AuthenticatedRequest } from "./authenticated-request";\n' +
    '+\n' +
    '+export function getAuthenticatedUserId(request: AuthenticatedRequest): string {\n' +
    '+  if (!request.user) {\n' +
    '+    throw new UnauthorizedException(\n' +
    '+      "Authenticated request is missing user payload",\n' +
    '+    );\n' +
    '+  }\n' +
    '+\n' +
    '+  return request.user.sub;\n' +
    '+}';

  // Real GitHub patch for a MODIFIED file (two hunks), market-movers.controller.ts, same PR.
  const MODIFIED_FILE_PATCH =
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

  it('recognizes a real added-file patch', () => {
    expect(isAddedFilePatch(ADDED_FILE_PATCH)).toBe(true);
  });

  it('rejects a modified-file patch (multiple hunks, non-"+"-only lines)', () => {
    expect(isAddedFilePatch(MODIFIED_FILE_PATCH)).toBe(false);
  });

  it('rejects a single-hunk patch whose old side is non-empty', () => {
    expect(isAddedFilePatch('@@ -1,3 +1,5 @@\n line1\n+line2\n line3')).toBe(false);
  });

  it('reconstructs the full file content from a real added-file patch', () => {
    const content = reconstructAddedFileContent(ADDED_FILE_PATCH);
    expect(content).toBe(
      'import { UnauthorizedException } from "@nestjs/common";\n' +
        'import type { AuthenticatedRequest } from "./authenticated-request";\n' +
        '\n' +
        'export function getAuthenticatedUserId(request: AuthenticatedRequest): string {\n' +
        '  if (!request.user) {\n' +
        '    throw new UnauthorizedException(\n' +
        '      "Authenticated request is missing user payload",\n' +
        '    );\n' +
        '  }\n' +
        '\n' +
        '  return request.user.sub;\n' +
        '}',
    );
    // The reconstructed content is real, valid TS — extractSymbols must find the function on it.
    const syms = extractSymbols(content!);
    expect(syms.map((s) => s.name)).toContain('getAuthenticatedUserId');
  });

  it('handles a trailing "\\ No newline at end of file" marker', () => {
    const patch = '@@ -0,0 +1,2 @@\n+line1\n+line2\n\\ No newline at end of file';
    expect(reconstructAddedFileContent(patch)).toBe('line1\nline2');
  });

  it('returns null for a modified-file patch', () => {
    expect(reconstructAddedFileContent(MODIFIED_FILE_PATCH)).toBeNull();
  });

  it('returns null for a multi-hunk patch even if each hunk looks added-shaped', () => {
    const patch = '@@ -0,0 +1,1 @@\n+a\n@@ -0,0 +3,1 @@\n+b';
    expect(reconstructAddedFileContent(patch)).toBeNull();
  });
});
