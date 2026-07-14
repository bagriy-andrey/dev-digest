/**
 * Enhanced regex symbol/reference extractor for TS/JS (A3, L04).
 *
 * DESIGN NOTE (tree-sitter vs. regex): the F1 scaffolding left a TODO to wire
 * `web-tree-sitter` for accurate blast-radius. Under the parallel-phase rules
 * we MUST NOT run installs, and `web-tree-sitter` additionally needs grammar
 * `.wasm` blobs shipped+loaded at runtime — not something we can verify in this
 * phase. So we **meaningfully strengthen the regex extractor** instead (and
 * declare `web-tree-sitter` as an optional future dep in the report). The
 * extractor below is line-based but covers the declaration/reference shapes
 * that matter for finding downstream callers in a TS/JS monorepo:
 *
 *   symbols     — function / async function / generator, exported const-arrow,
 *                 class + its methods, interface, type, enum. Export-awareness.
 *   references  — call sites `sym(`, `new Sym(`, member calls `.sym(`,
 *                 JSX usage `<Sym`, and `sym` used as an identifier passed as a
 *                 value — while EXCLUDING the declaration line, import lines,
 *                 and comments. This is what lets blast-radius resolve callers.
 *
 * It is intentionally conservative about false positives (skips comment lines,
 * import/export-from lines) so the blast graph stays trustworthy.
 *
 *   endpoints   — see `extractEndpoints` (Express/Fastify call-style routes) and
 *                 `extractNestRoutes` (decorator-style routes, e.g. NestJS `@Get()`) — two
 *                 separate scanners for two separate routing conventions, not one merged pass.
 */

export interface ExtractedSymbol {
  name: string;
  kind: string;
  line: number;
}

export interface ExtractedReference {
  toSymbol: string;
  line: number;
}

export interface ExtractedRoute {
  route: string; // "GET /portfolio/allocation"
  methodName: string; // bare handler name, matches ExtractedSymbol.name for the same method
  line: number;
}

const LINE_COMMENT = /^\s*(\/\/|\*|\/\*)/;
const IMPORT_LINE = /^\s*import\s|^\s*export\s+\{[^}]*\}\s+from\b|^\s*export\s+\*\s+from\b/;

/** Strip line/block-comment tails and string contents to reduce false matches. */
function sanitizeLine(line: string): string {
  // remove // comments
  let s = line.replace(/\/\/.*$/, '');
  // crude string blanking so `foo(` inside a string literal isn't a call
  s = s.replace(/(["'`])(?:\\.|(?!\1).)*\1/g, '""');
  return s;
}

const SYMBOL_PATTERNS: { re: RegExp; kind: string }[] = [
  // export? (default)? async? function* name(   |  function name(
  { re: /(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*[(<]/, kind: 'function' },
  // export? abstract? class Name
  { re: /(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/, kind: 'class' },
  // export? const|let name = (  ... ) =>   |  = async (  |  = function
  {
    re: /(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*(?::[^=]*)?=>|[A-Za-z_$][\w$]*\s*=>)/,
    kind: 'function',
  },
  { re: /(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/, kind: 'interface' },
  { re: /(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\s*[=<]/, kind: 'type' },
  { re: /(?:export\s+)?enum\s+([A-Za-z_$][\w$]*)/, kind: 'enum' },
];

// JS keywords / common no-symbol identifiers we never treat as a method/symbol.
const KEYWORDS = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'return', 'function', 'await', 'typeof',
  'new', 'delete', 'void', 'do', 'else', 'in', 'of', 'instanceof', 'yield', 'super',
  'constructor', 'get', 'set', 'import', 'export', 'as', 'from', 'class', 'extends',
]);

// class-body method:  name(args) {  | async name(args) {  | static name(args) {
const METHOD_RE =
  /^\s*(?:public\s+|private\s+|protected\s+|static\s+|readonly\s+|async\s+|\*\s*)*([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*(?::[^={]+)?\{/;

// A decorator-annotated parameter on the SAME line as the method (`list(@Request() request) {`,
// the standard NestJS handler shape) defeats METHOD_RE's single-level `[^)]*` — it stops at the
// FIRST `)` it meets (the decorator's own `@Request()`), never reaching the method's real closing
// paren, so the match silently fails. Strip one level of param-decorator calls before matching so
// only the method's own parens remain. Shared by `extractSymbols` (below) AND `extractNestRoutes`
// (further down) — both match against `METHOD_RE` and both need this.
const PARAM_DECORATOR_RE = /@[A-Za-z_$][\w$]*(?:\([^)]*\))?\s*/g;
function stripParamDecorators(line: string): string {
  return line.replace(PARAM_DECORATOR_RE, '');
}

/**
 * Resolves a class-body line to the method name it declares, covering both shapes `METHOD_RE`
 * alone can't: a same-line decorated param (`stripParamDecorators` handles that first) and a
 * multi-line signature (`METHOD_START_RE`/`findMultilineMethodBodyStart`, defined below — forward
 * reference is safe, this is only ever called after the module has fully loaded). Shared by
 * `extractSymbols` and `extractNestRoutes` — both need "what method does this line declare,"
 * just for different downstream purposes.
 */
function matchMethodDeclaration(lines: string[], i: number, strippedLine: string): string | null {
  const mm = strippedLine.match(METHOD_RE);
  if (mm?.[1] && !KEYWORDS.has(mm[1])) return mm[1];
  const startMatch = strippedLine.match(METHOD_START_RE);
  if (startMatch?.[1] && !KEYWORDS.has(startMatch[1]) && findMultilineMethodBodyStart(lines, i) !== null) {
    return startMatch[1];
  }
  return null;
}

/**
 * Extract declared symbols from a single file's source.
 * Tracks a shallow `class` context so methods are reported as `<Class>.<method>`
 * AND as bare `<method>` (so reference search can find either form).
 */
export function extractSymbols(content: string): ExtractedSymbol[] {
  const out: ExtractedSymbol[] = [];
  const lines = content.split('\n');
  let classDepth = 0;
  let currentClass: string | null = null;
  let braceDepth = 0;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!;
    if (LINE_COMMENT.test(raw)) {
      braceDepth += countBraces(raw);
      continue;
    }
    const line = sanitizeLine(raw);

    let matchedDecl = false;
    for (const { re, kind } of SYMBOL_PATTERNS) {
      const m = line.match(re);
      if (m?.[1] && !KEYWORDS.has(m[1])) {
        out.push({ name: m[1], kind, line: i + 1 });
        if (kind === 'class') {
          currentClass = m[1];
          classDepth = braceDepth;
        }
        matchedDecl = true;
        break;
      }
    }

    // Methods inside a class body (only when we're one level into the class). Decorator-
    // annotated params (`stripParamDecorators`) and multi-line signatures
    // (`findMultilineMethodBodyStart`) are both real, common NestJS shapes — see their doc
    // comments below; a plain `line.match(METHOD_RE)` misses both.
    if (!matchedDecl && currentClass && braceDepth === classDepth + 1) {
      const methodName = matchMethodDeclaration(lines, i, stripParamDecorators(line));
      if (methodName) {
        out.push({ name: `${currentClass}.${methodName}`, kind: 'method', line: i + 1 });
        out.push({ name: methodName, kind: 'method', line: i + 1 });
      }
    }

    braceDepth += countBraces(line);
    if (currentClass && braceDepth <= classDepth) currentClass = null;
  }
  return dedupeSymbols(out);
}

function countBraces(s: string): number {
  let n = 0;
  for (const ch of s) {
    if (ch === '{') n++;
    else if (ch === '}') n--;
  }
  return n;
}

function dedupeSymbols(syms: ExtractedSymbol[]): ExtractedSymbol[] {
  const seen = new Set<string>();
  const out: ExtractedSymbol[] = [];
  for (const s of syms) {
    const key = `${s.name}:${s.kind}:${s.line}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

/**
 * Find references (call sites / usages) of `symbol` in a file's source.
 * Matches `sym(`, `new sym(`, `.sym(`, `<Sym`, and bare-identifier usage that
 * is NOT the declaration. Skips import lines and comment lines.
 */
export function extractReferences(content: string, symbol: string): ExtractedReference[] {
  // Reference search works on the *method/function name* — if the caller passes
  // a `Class.method` symbol, match on the trailing member.
  const bare = symbol.includes('.') ? symbol.split('.').pop()! : symbol;
  const escaped = bare.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const callRe = new RegExp(`(?<![\\w$.])${escaped}\\s*\\(`); // sym(
  const memberCallRe = new RegExp(`\\.${escaped}\\s*\\(`); // .sym(
  const newRe = new RegExp(`new\\s+${escaped}\\b`); // new Sym
  const jsxRe = new RegExp(`<${escaped}[\\s/>]`); // <Sym

  const declRe = new RegExp(
    `(?:function\\s*\\*?\\s*|class\\s+|interface\\s+|type\\s+|enum\\s+|(?:const|let|var)\\s+)${escaped}\\b`,
  );

  const out: ExtractedReference[] = [];
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!;
    if (LINE_COMMENT.test(raw) || IMPORT_LINE.test(raw)) continue;
    const line = sanitizeLine(raw);
    if (declRe.test(line)) continue; // the declaration itself is not a reference
    if (callRe.test(line) || memberCallRe.test(line) || newRe.test(line) || jsxRe.test(line)) {
      out.push({ toSymbol: symbol, line: i + 1 });
    }
  }
  return out;
}

/**
 * Heuristic endpoint detector: HTTP route registrations in a file.
 * Catches Fastify/Express style `app.get('/path', ...)`, `router.post(...)`,
 * `app.get<...>('/path')`, and `route({ method, url })`. Returns "METHOD /path".
 */
export function extractEndpoints(content: string): string[] {
  const out = new Set<string>();
  const lines = content.split('\n');
  const verbRe =
    /\b(?:app|router|fastify|server|api)\.(get|post|put|patch|delete|options|head)\s*(?:<[^>]*>)?\s*\(\s*(['"`])([^'"`]+)\2/i;
  const routeObjRe = /method\s*:\s*['"`](GET|POST|PUT|PATCH|DELETE)['"`][\s\S]*?url\s*:\s*['"`]([^'"`]+)['"`]/i;
  for (const raw of lines) {
    const m = raw.match(verbRe);
    if (m) out.add(`${m[1]!.toUpperCase()} ${m[3]}`);
    const r = raw.match(routeObjRe);
    if (r) out.add(`${r[1]!.toUpperCase()} ${r[2]}`);
  }
  return [...out];
}

const CLASS_DECL_RE = SYMBOL_PATTERNS.find((p) => p.kind === 'class')!.re;
const CONTROLLER_DECORATOR_RE = /@Controller\s*\(\s*(?:['"`]([^'"`]*)['"`])?\s*\)/;
// @All is intentionally not matched — same "no catch-all verb" stance extractEndpoints takes.
const ROUTE_VERB_DECORATOR_RE = /@(Get|Post|Put|Patch|Delete)\s*\(\s*(?:['"`]([^'"`]*)['"`])?\s*\)/;
const DECORATOR_LINE_RE = /^\s*@\w+/;
const BLANK_RE = /^\s*$/;
// Bounded backward scan for the decorator run immediately above a method — NestJS stacks
// decorators (`@UseGuards(...)` above `@Get(...)` above the method), so we walk up over
// consecutive decorator/blank/comment lines until real content or the cap is hit.
const MAX_DECORATOR_LOOKBACK = 10;

function joinRoutePath(prefix: string, sub: string): string {
  const p = prefix.replace(/^\/+|\/+$/g, '');
  const s = sub.replace(/^\/+|\/+$/g, '');
  return `/${[p, s].filter(Boolean).join('/')}`;
}

// `sanitizeLine` blanks string-literal CONTENTS (`'portfolio'` → `""`) — right for structural
// matching (METHOD_RE/CLASS_DECL_RE don't care what's inside a string) but wrong here: the
// decorator's literal path argument IS the value we need. Strip only trailing `//` comments,
// keep the actual string contents intact.
function stripLineComment(line: string): string {
  return line.replace(/\/\/.*$/, '');
}

// Name immediately followed by `(`, WITHOUT requiring the rest of the signature (params/return
// type/body brace) on the same line — a looser opener than METHOD_RE, used only to detect where
// a multi-line signature (see below) begins.
const METHOD_START_RE =
  /^\s*(?:public\s+|private\s+|protected\s+|static\s+|readonly\s+|async\s+|\*\s*)*([A-Za-z_$][\w$]*)\s*\(/;
const MAX_SIGNATURE_LOOKAHEAD = 20;

// Real NestJS handlers routinely put ONE decorated param per line for readability
// (`@Request() request: X,` / `@Query() query: Y,` each on their own line) — METHOD_RE requires
// the ENTIRE `name(...) {` on one line, so it never matches these at all (not a decorator-parens
// issue like `stripParamDecorators` fixes — the name and the body-opening `{` are simply on
// different lines). Bounded forward scan from a line that STARTS a method (`METHOD_START_RE`)
// but doesn't close it there: track paren balance across subsequent lines until it returns to 0,
// then confirm a `{` follows before anything else (a real body, not a signature-only
// interface/abstract declaration). Returns the line index the body opens on, or null.
function findMultilineMethodBodyStart(lines: string[], startIdx: number): number | null {
  let parenDepth = 0;
  let seenOpenParen = false;
  for (let k = startIdx; k < lines.length && k < startIdx + MAX_SIGNATURE_LOOKAHEAD; k += 1) {
    const s = sanitizeLine(lines[k]!);
    for (const ch of s) {
      if (ch === '(') {
        parenDepth += 1;
        seenOpenParen = true;
      } else if (ch === ')') {
        parenDepth -= 1;
      }
    }
    if (seenOpenParen && parenDepth <= 0) {
      const afterParens = s.slice(s.lastIndexOf(')') + 1);
      return /^\s*(?::[^={]+)?\{/.test(afterParens) ? k : null;
    }
  }
  return null;
}

function findPrecedingRouteDecorator(
  lines: string[],
  methodLineIdx: number,
): { verb: string; path: string } | null {
  let scanned = 0;
  for (let j = methodLineIdx - 1; j >= 0 && scanned < MAX_DECORATOR_LOOKBACK; j -= 1, scanned += 1) {
    const raw = lines[j]!;
    if (LINE_COMMENT.test(raw) || BLANK_RE.test(raw)) continue;
    const line = stripLineComment(raw);
    const m = line.match(ROUTE_VERB_DECORATOR_RE);
    if (m) return { verb: m[1]!.toUpperCase(), path: m[2] ?? '' };
    if (DECORATOR_LINE_RE.test(line)) continue;
    break; // real (non-decorator) content — the decorator run above the method ends here
  }
  return null;
}

/**
 * Decorator-aware NestJS route detector — `extractEndpoints` above only recognizes
 * `verb.method('/path', ...)` CALLS (this project's own Fastify convention) and is
 * structurally blind to `@Controller()`/`@Get()`-style decorator routing, which has no such
 * call anywhere in the file. Kept as a separate function (not merged into `extractEndpoints`)
 * so each stays a single readable regex pass scoped to one routing convention.
 *
 * Tracks `@Controller(prefix)` class scope the same way `extractSymbols` tracks `currentClass`
 * (brace-depth based), then for each method inside that scope looks backward over its
 * decorator run for an HTTP-verb decorator. Multi-line decorator argument lists are not
 * matched (single-line only, same precision tradeoff as the rest of this module).
 */
export function extractNestRoutes(content: string): ExtractedRoute[] {
  const out: ExtractedRoute[] = [];
  const lines = content.split('\n');
  let braceDepth = 0;
  let controllerDepth: number | null = null;
  let controllerPrefix = '';
  let pendingControllerPrefix: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!;
    if (LINE_COMMENT.test(raw)) {
      braceDepth += countBraces(raw);
      continue;
    }
    const line = sanitizeLine(raw);

    const ctrlMatch = stripLineComment(raw).match(CONTROLLER_DECORATOR_RE);
    if (ctrlMatch) pendingControllerPrefix = ctrlMatch[1] ?? '';

    const classMatch = line.match(CLASS_DECL_RE);
    if (classMatch && pendingControllerPrefix !== null) {
      controllerPrefix = pendingControllerPrefix;
      controllerDepth = braceDepth;
      pendingControllerPrefix = null;
    }

    if (controllerDepth !== null && braceDepth === controllerDepth + 1) {
      const methodName = matchMethodDeclaration(lines, i, stripParamDecorators(line));
      if (methodName) {
        const decorator = findPrecedingRouteDecorator(lines, i);
        if (decorator) {
          out.push({
            route: `${decorator.verb} ${joinRoutePath(controllerPrefix, decorator.path)}`,
            methodName,
            line: i + 1,
          });
        }
      }
    }

    braceDepth += countBraces(line);
    if (controllerDepth !== null && braceDepth <= controllerDepth) {
      controllerDepth = null;
      controllerPrefix = '';
    }
  }
  return out;
}

/**
 * Heuristic cron/scheduled-job detector. Catches cron expressions in
 * `schedule('* * * * *')`, `cron.schedule(...)`, `CronJob(...)`, and
 * `jobs.register('kind')` / `enqueue(ws, 'kind')` style background work.
 */
export function extractCrons(content: string): string[] {
  const out = new Set<string>();
  const lines = content.split('\n');
  const cronExprRe = /\b(?:cron|schedule|CronJob)\s*[.(]?\s*\(?\s*['"`]([^'"`]*(?:\*|\d+\s+\d+)[^'"`]*)['"`]/i;
  const jobKindRe = /\b(?:register|enqueue)\s*\(\s*(?:[A-Za-z0-9_$.]+\s*,\s*)?['"`]([a-z][a-z0-9_]*)['"`]/i;
  for (const raw of lines) {
    const m = raw.match(cronExprRe);
    if (m) out.add(m[1]!.trim());
    const j = raw.match(jobKindRe);
    if (j && /poll|index|clone|digest|cron|sync|schedule|job/i.test(raw)) out.add(`job:${j[1]}`);
  }
  return [...out];
}

/**
 * True iff `patch` is GitHub's unified-diff hunk for a brand-new file — a single hunk whose old
 * side has zero lines (`@@ -0,0 +1,N @@`), meaning the file didn't exist before this diff. Used
 * to decide whether `reconstructAddedFileContent` can safely treat the patch as the WHOLE file
 * rather than a partial modification hunk.
 */
export function isAddedFilePatch(patch: string): boolean {
  const hunkHeaders = patch.split('\n').filter((l) => l.startsWith('@@'));
  if (hunkHeaders.length !== 1) return false;
  return /^@@ -0,0 \+\d+(?:,\d+)? @@/.test(hunkHeaders[0]!);
}

/**
 * Reconstructs a brand-new file's full content from its GitHub unified-diff patch — every line in
 * an added-file patch is an addition (`+`), so stripping the leading `+` (and the `@@ ... @@`
 * header / `\ No newline at end of file` marker) recovers the exact source text, no base content
 * needed. Returns null (never guesses) when `patch` isn't a clean single-hunk added-file patch, or
 * contains a context/removal line that shouldn't exist in one (GitHub anomaly / truncation).
 */
export function reconstructAddedFileContent(patch: string): string | null {
  if (!isAddedFilePatch(patch)) return null;
  const out: string[] = [];
  let inHunk = false;
  for (const line of patch.split('\n')) {
    if (line.startsWith('@@')) {
      inHunk = true;
      continue;
    }
    if (!inHunk) continue;
    if (line.startsWith('\\ No newline at end of file')) continue;
    if (!line.startsWith('+')) return null;
    out.push(line.slice(1));
  }
  return out.join('\n');
}
