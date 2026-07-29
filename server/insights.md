# server — insights

> Durable, non-obvious learnings for `@devdigest/api` (Fastify, Drizzle, DI/container, and the
> repo-intel indexer that lives inside this package). Maintained via the `engineering-insights`
> skill: append-only, deduplicated, substance only. Read before working; empty sections are
> expected, not a bug. Cross-package facts go in the repo-root `insights.md`.

## What Works

## What Doesn't Work

- `tsx watch` does NOT hot-reload changes to `vendor/shared/**` files. `DEFAULTS` in `feature-models.ts` is computed at module-load time from `FEATURE_MODELS`; editing `vendor/shared/contracts/platform.ts` has no effect until the server process is killed and restarted. This burned ~30 min chasing a stale `openai` default.
- **`isConfigChange` (`modules/agents/helpers.ts:62-87`), which decides whether an agent update bumps `agents.version` and writes a new `agent_versions` snapshot, compares only agent-row columns (provider/model/system_prompt/output_schema/strategy/ci_fail_on/repo_intel) and completely ignores `agent_skills`.** Found while spec'ing Eval Pipeline's "Promote vN" (`specs/eval-pipeline.md`, AC-32): restoring a past version's config that differs from the live agent ONLY in its linked skill set would silently leave `agents.version` unchanged and write no new snapshot — so a later eval batch tagged with "version N" would be scored against a config whose `agent_versions` snapshot no longer describes what actually ran (the skills silently reverted but the version number and its snapshot didn't move). This is a real reproducibility hole in the existing versioning mechanism, not something new code introduces. ⇒ Any feature reading `agent_versions` as a source of truth for "what config produced this result" must treat a skills-only change as unversioned today; fixing `isConfigChange` to also diff the ordered enabled-skill-id list closes it.
- `pnpm db:generate` (`drizzle-kit generate`) was BROKEN (fixed 2026-07-04) by a corrupted merge in commit `0148df2` ("renumber migrations 0010/0011 → 0011/0012"), which took two independently-branched migrations (Skills, Conventions) and renamed them onto the same numeric slots WITHOUT re-chaining or re-deriving their snapshots. Two separate, compounding symptoms from the same root cause:
  1. `0011_snapshot.json` and `0012_snapshot.json` had the SAME `id` AND the same `prevId` — drizzle-kit's snapshot-chain validator saw two children of one parent ("collision") and aborted before diffing any new schema at all.
  2. Once (1) is fixed, a SECOND, more insidious symptom surfaces: both snapshots also silently DROPPED the `agent_runs.cost_usd` column from their `tables` section — even though migration `0010_cheerful_shard.sql` (from the "add costs to pr review" commit, `b058639`) genuinely adds it and it IS applied in the real DB. The merge kept `0010`'s snapshot correct but based `0011`/`0012` on a pre-`b058639` schema state, so their column lists silently regressed. Symptom: any subsequent `db:generate` — even for a totally unrelated new table — sees `cost_usd` as "missing" (relative to the stale 0012 snapshot) and generates a spurious `ALTER TABLE agent_runs ADD COLUMN cost_usd` that fails at `db:migrate` time with `column "cost_usd" ... already exists`, because the column was never actually missing — only its snapshot bookkeeping was. **Do not "fix" this by generating a catch-up migration for the phantom column** (that was tried and reverted this session) — the correct fix is repairing the snapshot's `columns` map to match reality, not adding a redundant migration.
  Both snapshot `id`/`prevId` AND the `cost_usd` column entry were manually repaired directly in `0011_snapshot.json`/`0012_snapshot.json`. The runtime migrator (`drizzle-orm/postgres-js/migrator` via `src/db/migrate.ts`) was never affected by any of this — it only reads `_journal.json` and applies `.sql` files in order by hash, so `pnpm db:migrate` worked fine throughout. ⇒ If `db:generate` ever again proposes a change to a column you believe already exists and is already migrated, suspect stale/corrupted snapshot metadata before assuming real drift — check `git log -- <migration>.sql` and grep the column into every snapshot in the chain, don't just trust the newest one.

- **`extractEndpoints()` (`server/src/adapters/codeindex/extract.ts:182-195`) only recognizes
  Express/Fastify-style route REGISTRATION CALLS — `verb.method('/path', ...)` or a `{method,
  url}` object literal — via regex. It does NOT recognize decorator-based routing (NestJS
  `@Controller()`/`@Get()`/`@Post()` etc., or any other decorator-driven framework): a NestJS
  controller file has no `app.get(...)`-shaped call anywhere, so `file_facts.endpoints` is `[]`
  for every such file, unconditionally — not a coverage gap that sometimes misses a route, a
  total blind spot for the whole framework. Symptom in Blast Radius: `impactedEndpoints`/
  `endpoints_affected` (`repo-intel/service.ts:420-442`) stays empty even when
  `tryPersistentBlast`'s reachability walk correctly reaches a NestJS controller file within
  `BFS_DEPTH` — the callers list is right, only the endpoint attribution is silently empty.
  Confirmed via a minimal repro: `extractEndpoints()` called directly on a `@Controller()`/`@Get()`
  source string returns `[]`. ⇒ Blast Radius / repo-intel endpoint detection is scoped to this
  project's own Fastify convention; testing or demoing it against a NestJS (or any
  decorator-routed) target repo will always show `0 endpoints` regardless of how correct the
  reachability graph is. Fixing this needs a second, decorator-aware extractor (parse
  `@Controller(prefix)` + method-level `@Get/@Post/...` decorators), not a BFS_DEPTH or
  caller-resolution change.

- **`extract.ts`'s shared `METHOD_RE` (used by `extractSymbols` AND the new `extractNestRoutes`)
  fails on real-world NestJS handler signatures in TWO distinct, compounding ways** — found only
  by testing against an actual cloned NestJS repo (`bagriy-andrey/ai-stock-app`), not caught by
  synthetic unit fixtures written before that: (1) a decorated parameter on the SAME line as the
  method (`getWatchlist(@Request() request) {`) defeats `[^)]*`'s single-level paren matching —
  the regex stops at `@Request()`'s own `)`, never reaching the method's real closing paren, so
  the whole match fails silently (not a partial/wrong match — `null`). (2) the far more common
  real style — ONE decorated param per line (`@Request() request: X,` / `@Query() query: Y,` each
  on their own line, exactly how `portfolio.controller.ts`/`transactions.controller.ts`/
  `watchlist.controller.ts` are written) puts the method name+`(` and the closing `)...{` on
  DIFFERENT lines — `METHOD_RE` can never match this AT ALL, regardless of (1)'s fix, since it
  requires the whole signature on one line. Fixed locally inside `extractNestRoutes` (not by
  changing the shared `METHOD_RE`/`extractSymbols`, to avoid an unreviewed blast radius on
  everything else that already depends on their exact behavior): `stripParamDecorators()` (regex,
  strips one level of `@Foo(...)` calls before matching) for (1), and
  `findMultilineMethodBodyStart()` (bounded 20-line forward paren-balance scan) for (2). ⇒ Any
  future regex-based TS extractor claiming to handle "real" NestJS/decorator-heavy code MUST be
  tested against an actual cloned repo with that style, not just single-line synthetic fixtures —
  synthetic fixtures silently hide exactly this class of bug because it's easy to accidentally
  write single-line test signatures that don't reflect real formatting conventions.

- **`sanitizeLine()` (`extract.ts`) blanks string-literal CONTENTS** (`'portfolio'` → `""`) —
  correct for `METHOD_RE`/`CLASS_DECL_RE` structural matching (they don't care what's inside a
  string) but silently destroys the actual VALUE when a caller needs the literal itself. Bit
  `extractNestRoutes` initially: matching `@Controller('portfolio')` against a `sanitizeLine`d
  line always captured an EMPTY prefix (the quotes survive, the content between them doesn't),
  producing routes like `GET /` instead of `GET /portfolio/...` — no error, no test failure until
  the resulting path was asserted, easy to miss if a test only checks "a route was found" without
  checking its exact string. Fixed with a separate, lighter `stripLineComment()` (removes only
  trailing `//` comments) used specifically where the literal argument value is needed. ⇒ Before
  reusing `sanitizeLine` in a new extractor, ask whether the extractor needs a string's STRUCTURE
  (call it) or its CONTENT (don't — use raw/comment-stripped only).

- **`resyncRepo`/`RESYNC_JOB_KIND` runs `runIncremental`, which only re-parses files whose git
  content changed since `lastIndexedSha`** — it has no concept of "the indexer's own extraction
  logic changed." After editing `extractNestRoutes`/`extractEndpoints` and hitting
  `POST /repos/:id/resync` against an already-indexed demo repo, `file_facts` rows for untouched
  files stayed exactly as they were before the code change (verified via direct
  `SELECT * FROM file_facts` — zero rows for known-NestJS controller files after a resync that
  reported success). Only calling `container.repoIntel.indexRepo(repoId)` directly (a FULL index,
  bypassing the git-diff-based incremental gate) re-ran the new extractor against every file and
  produced the expected `route_symbols`. ⇒ To verify an indexer/extractor LOGIC change against an
  already-indexed local repo, force a full reindex — `resync` will silently appear to succeed
  while doing nothing for files whose source didn't change, which reads exactly like "my fix
  doesn't work" when it's actually "the file was never re-parsed."

- **`DepCruiseGraph.buildEdges` (`adapters/depgraph/index.ts`, dependency-cruiser wrapper) drops
  MOST of a file's real local import edges on at least one real repo** — confirmed via direct
  `SELECT` on `file_edges` for `bagriy-andrey/ai-stock-app`'s `portfolio.controller.ts`: only ONE
  edge persisted (`-> jwt-auth.guard.ts`) despite the file's own source importing ~10 local
  modules including `PortfolioService`/`PortfolioPerformanceService` (constructor-injected) and
  several DTOs. This independently blocks Blast Radius's hop-2 reverse-import reachability from
  ever reaching a controller through its service layer on this repo, REGARDLESS of the NestJS
  endpoint-detection fix above (`route_symbols` was correctly populated on the controller file
  itself — the graph never gets there to read it). Root cause not investigated (tsconfig
  path-alias resolution in this specific monorepo layout is one candidate — `buildEdges` only
  checks for a ROOT `tsconfig.json`, `index.ts:62`, which may not cover an
  `apps/api`-nested package's own module resolution). ⇒ A "0 endpoints" or "missing hop-2 caller"
  symptom on a real repo can ALSO be a `file_edges` graph-completeness problem, not just an
  endpoint-detection or attribution problem — check `file_edges` directly for the files involved
  before assuming the bug is in `extract.ts` or `tryPersistentBlast`. Worth its own investigation/
  spec; not attempted here (out of scope for the NestJS-decorator-detection fix).

- **`tryPersistentBlast`'s Phase 2 hop-2 caller dedup (`repo-intel/service.ts:543`) keys
  `existingHop1` by `file|symbolName` only — no line number/enclosing-method — so it silently
  drops a genuinely NEW call site added by a PR when the same file already has ANY reference to
  that symbol in the persisted index.** E.g. if `market-movers.controller.ts` already calls
  `getAuthenticatedUserId` once, and the PR adds a second call to the same function from a
  different handler in the same file, the new call site never gets added to `callers[]` — blast
  radius misses a real new caller. Found by dogfooding the pre-push CLI (`devdigest review
  --mode working`, `specs/pre-push-cli.md`) against this repo's own working-tree diff — the
  General Reviewer agent flagged it as CRITICAL. ⇒ The dedup key needs the line number (or
  enclosing symbol) to distinguish distinct call sites within the same file, not just
  `file|symbolName`. Not yet fixed as of 2026-07-13.

## Codebase Patterns

- `agent_skills` join table now has `enabled boolean NOT NULL DEFAULT true` (migration 0011). Skill injection in `run-executor.ts` must filter BOTH `link.enabled && link.skill.enabled` — one flag is global (skill disabled for everyone), the other is per-agent. Filtering only one silently passes disabled skills through.
- Skills prompt injection lives entirely in `run-executor.ts → runOneAgent`: load `agentsRepo.linkedSkills(agent.id)`, filter where `link.enabled && link.skill.enabled`, map to bodies, pass as `skills:` to `reviewPullRequest`. The `reviewer-core` prompt assembler already accepts `parts.skills?: string[]` and produces `## Skills / rules` — no changes to `reviewer-core` needed.
- `modules/skills/` follows the standard `repository → service → routes` pattern. The service is NOT in the DI container (`platform/container.ts`) — it is instantiated directly in routes via `new SkillsService(app.container.db)`. This matches the lesson scope and avoids container churn.
- `AgentSkillLink` shared contract (in both `server/src/vendor/shared` and `client/src/vendor/shared`) must be kept in sync manually — it's vendored, not npm. Added `enabled: z.boolean().default(true)` to both copies in this session.
- `@fastify/multipart` must be registered globally in `app.ts` before any route calls `req.file()`. It was absent from the server's plugin list; adding it after SSEPlugin works fine.
- Skills stats query (`getStats`) does not join through a `skill_id` on `findings` — there is no such column. Instead it uses the agent-level proxy: find all agents with this skill linked (`agent_skills`), then aggregate `findings` via `reviews → agent_runs` filtered by those agent IDs. This means "findings for this skill" really means "findings from agents that use this skill", which is the correct semantic.
- Skill body versioning: write the OLD body to `skill_versions` BEFORE updating `skills.body`. The snapshot captures the pre-change state so version history is a full replayable log.
- `findings` has no direct `pr_id` column — to query findings by PR you must JOIN through `reviews`: `findings.review_id → reviews.id → reviews.pr_id`. Any new findings-by-PR query needs `.innerJoin(t.reviews, eq(t.findings.reviewId, t.reviews.id)).where(inArray(t.reviews.prId, prIds))`.
- `agent_runs`-write signatures are declared **twice** and BOTH must change together: the impl `repository/run.repo.ts::completeAgentRun` AND the class facade `repository.ts::completeAgentRun`. Add a field to only one and `tsc` fails at the call site in `run-executor.ts`, not at the facade — so the error points away from the file you forgot.
- First jsonb `->>` text-extraction query in this codebase (`EvalsRepository.findByFindingId`, SPEC-03 step 3, `modules/evals/repository.ts`): a plain `sql\`${t.evalCases.inputMeta} ->> 'finding_id' = ${findingId}\`` template drops straight into `and(...)` alongside ordinary `eq()` conditions with no special typing — `Db`'s `.where()` accepts a bare `SQL` fragment as one of the `and()` args just like any other condition. The same pattern (`sql\`${col} is not null\`` filtering before a `groupBy`, and `desc(sql\`max(${col})\`)` as the `orderBy` expression for a "most-recent-per-group" query, e.g. `EvalsRepository.batchesForOwner`'s "distinct batch_id ordered by its newest run") also typechecks with no raw-string escape hatch — worth reusing verbatim for the next jsonb-matching or grouped-aggregate query rather than reaching for a raw `db.execute(sql...)` round trip.

- **Per-feature model selection (`FEATURE_MODELS` / `resolveFeatureModel`) is scoped per-WORKSPACE only — there is no per-repo override anywhere.** `settings` table columns are `(workspace_id, user_id, key, value)` with a unique index on those three (`server/src/db/schema/core.ts`); `repos` has no config/settings JSON column at all (`server/src/db/schema/repos.ts`). `resolveFeatureModel(container, workspaceId, id)` (`modules/settings/feature-models.ts`) only ever reads the workspace-scoped row. ⇒ Any feature wanting "global default + per-repo override" model selection needs NEW schema (e.g. a `repo_id` column on `settings`, or a config column on `repos`) — it cannot be built by reusing the existing mechanism as-is.
- The `'review_intent'` `FeatureModelId` is registered in `FEATURE_MODELS` (`vendor/shared/contracts/platform.ts`, default `openai/gpt-4.1`) and `pr_intent`/`pr_brief` DB tables + `Intent` zod contract + `ReviewRepository.getIntent`/`upsertIntent` all exist, but **nothing in `server/src` actually calls `resolveFeatureModel(..., 'review_intent')` or `getIntent`/`upsertIntent`** — grep confirms zero call sites outside the repository/contract layer itself. This is pure unbuilt scaffolding (see root `insights.md` for the full cross-cutting picture), not a working feature to build on top of.
- The `SmartDiff`/`SmartDiffGroup`/`SmartDiffFile`/`SmartDiffRole`/`ProposedSplit` zod contracts already exist, fully defined and byte-identical, in both vendored copies (`server/src/vendor/shared/contracts/brief.ts:80-113` and `client/src/vendor/shared/contracts/brief.ts:80-113`) as part of the composed `PrBrief` doc — but grep confirms zero producers/consumers anywhere in `server/src` or `client/src` outside the contract file itself. Same "scaffolding exists, nothing wired" shape as `review_intent` above. A Smart-Diff feature building on this must NOT redefine the contract, only compose it.
- "Latest review per PR" has an existing, reusable precedent: `server/src/modules/pulls/routes.ts:114-127` derives it by iterating `reviewsForPull`'s newest-first (`desc(createdAt)`) list and taking the first row per `prId` (filtered to `kind === 'review'`) into a `Map`. There is no `is_latest` flag anywhere in the schema — any new feature needing "the latest completed review" should reuse this same reduction over `ReviewRepository.reviewsForPull`, not invent new query logic.
- **`RepoIntelService.getBlastRadius`'s persistent path (`tryPersistentBlast`,
  `modules/repo-intel/service.ts:315-391`) only finds DIRECT (1-hop) callers of a changed
  symbol, despite `BFS_DEPTH = 2` existing as a constant** (`repo-intel/constants.ts`).
  `getResolvedCallers` filters `references.declFile IN changedFiles AND toSymbol IN names` — a
  single hop. `BFS_DEPTH` is only ever consumed by the unrelated `getCriticalPaths` (onboarding,
  walks `file_edges`). So a route handler that calls a wrapper that calls the changed helper (2
  hops away) is invisible to `getBlastRadius` today — endpoints/crons are only attributed from
  the direct callers' own `file_facts`. ⇒ Any feature needing deeper reachability (e.g. Blast
  Radius L04) must extend `tryPersistentBlast` itself, not assume `BFS_DEPTH` already covers it.
  The cheapest extension is calling `getResolvedCallers` a SECOND time with hop-1's caller files/
  enclosing-symbol names as hop-2's input (same method, no new query/repository code) — not
  pulling in `file_edges`/`getEdges` (that's file-level import edges, coarser than the
  symbol-level call graph this actually needs). See `server/specs/blast-radius.md` §1.A for the
  worked-out provenance-tracking design (attributing hop-2 endpoints back to the originating
  changed symbol via a `Map<enclosingName, Set<originalSymbolName>>`).

  **2026-07-09 correction: the "call `getResolvedCallers` a second time" design above was
  SUPERSEDED before implementation and is NOT what shipped.** The `fileEdges` schema comment
  (`server/src/db/schema/repo-intel.ts:51-53`: "the reverse-lookup index `(repoId, toFile)` is
  what blast uses to walk 'who depends on this file?'") is authoritative original-author intent
  that a symbol-level call-graph re-query approach misses entirely — it explicitly names "blast"
  and describes a **file-level reverse-import walk**, not a second `references` query. What
  actually shipped: a new pure `repo-intel/blast-reachability.ts::reverseReachableFiles(edges,
  seeds, depth, cap)` (hermetically unit-tested, no DB) doing a reverse BFS over `file_edges`
  (`toFile → fromFile`) seeded at the changed files, capped per-seed by a new
  `MAX_REACHABLE_FILES` constant, reusing `BFS_DEPTH` (finally consumed on the blast path it was
  named for). Endpoint/cron attribution is **file-scoped**: every changed symbol inherits the
  endpoints/crons reachable from its *declaring file*, not computed per-symbol via the call
  graph. ⇒ **Always check a table's schema-file doc comment before designing a read pattern
  against it** — it can encode the original author's intended access pattern in a way that's
  easy to miss from grepping call sites alone (the comment predated any of this feature's
  analysis and was more reliable than independently re-deriving the mechanism).

- **`RepoIntelService.getBlastRadius`'s `callers[]` cap (`MAX_CALLERS_PER_SYMBOL = 20`) was
  applied GLOBALLY across the whole response, not per changed symbol, despite the constant's own
  doc comment** (`repo-intel/constants.ts:29`: "caller fan-out cap per changed symbol"). The old
  code did `callers.sort(...).slice(0, MAX_CALLERS_PER_SYMBOL)` on the flat merged array — a PR
  changing 2 symbols with 15 callers each would silently lose 10 callers of whichever symbol
  sorted second, not cap each at 20. Fixed (2026-07-09, part of the Blast Radius feature) by
  grouping by `viaSymbol` and capping each group independently before flattening. ⇒ When a
  "cap N per X" constant is consumed via a single `.slice()` on an already-flattened array across
  multiple X's, check whether the cap is actually being applied per-group or just once globally —
  the doc comment and the code silently disagreed here for the whole T3 lifetime of this path.

- `POST /pulls/:id/review` is fire-and-forget: `ReviewService.runReview` (`reviews/service.ts`) returns `{pr_id, runs, reviews: []}` IMMEDIATELY — `reviews` is always empty in that response — while the actual LLM run continues in the background. Any external client (CLI, MCP server, script) that expects the verdict/findings back from this POST will get nothing useful; it must poll `GET /pulls/:id/runs` until a run's `status` is `done`/`failed`/`cancelled`, then read `GET /pulls/:id/reviews` for the persisted result. Found while planning a new MCP-server client against this API (`specs/mcp-server.md`) — the naive assumption (POST returns the review) is wrong and would have shipped a broken single-call integration.

- **Ad-hoc (non-PR) review reuse points**, found while planning the Pre-push CLI
  (`specs/mcp-server.md` follow-up, no code written yet): `parseUnifiedDiff()`
  (`adapters/git/diff-parser.ts`) has no PR-specific assumptions — it parses ANY standard
  `git diff` text into `UnifiedDiff`, so a raw local working-tree diff (no PR behind it) needs
  zero new parsing code. `ReviewRunExecutor.runOneAgent`'s three enrichment helpers
  (`buildCallersDigest`/`buildRepoMapDigest`/`buildRankNote`, `reviews/run-executor.ts`) take only
  `repoId` (+ `diff` for two of them) — they never touch `pull`/`PullRow` — so they, and the
  `reviewPullRequest(...)` call itself, can be extracted into a shared helper reusable by a future
  non-PR review endpoint without duplicating the enrichment logic. Only `taskLine(pull)` is
  genuinely PR-shaped and needs a substitute string when there's no PR. Separately: agents have no
  "default" concept — the `agents` table has only `enabled`, no `isDefault`/`isPrimary` column
  (confirmed by grep) — so any caller needing "the agent" without an explicit id must either
  require one or run all of `listEnabled(workspaceId)`. And `RepoRepository.findByFullName`
  (`modules/repos/repository.ts:23`) already does owner/name → repo resolution, but only
  `RepoService.add`'s dedupe check calls it — no route exposes it, and an external caller can get
  the same result by filtering the existing `GET /repos` list client-side (it already returns
  `full_name`), so this doesn't need a new endpoint either.

- **Importing a repo (`POST /repos`) does NOT import its pull requests — PR sync happens lazily on the first `GET`.** The body is only `{ url }` (`RepoInput`, `vendor/shared/contracts/platform.ts`); `RepoService.add` (`modules/repos/service.ts:86-106`) derives owner/name from the URL, persists the row, and enqueues an async clone+index job — no PR data is touched. Pull requests only get fetched/upserted (`onConflictDoUpdate` on `repo_id`+`number`) as a side effect of `GET /repos/:id/pulls` (`modules/pulls/routes.ts:26-227`) or `GET /pulls/:id` for per-PR detail — i.e. simply *viewing* a repo's PRs is what triggers the GitHub sync. There is no dedicated `POST /repos/:id/sync`-style endpoint. ⇒ Any external client (MCP server, script) that imports a repo and then immediately expects `GET /repos/:id/pulls` to return real data must call that GET at least once to trigger the sync — it isn't populated by the import call itself.

- **`ContainerOverrides` (`platform/container.ts`) does NOT cover `agentsRepo`** — the
  `container.agentsRepo` getter unconditionally does `new AgentsRepository(this.db)` with no
  override check (unlike `llm`/`repoIntel`/`git`/etc, which all check `this.overrides.X` first).
  A hermetic test that needs to mock `agentsRepo.linkedSkills(...)` (e.g. for the
  `runAgentReview` extraction, `modules/reviews/agent-runner.ts`) can't get there via
  `new Container(config, db, { overrides })` — it must build a plain object literal with the
  needed surface (`{ llm: async () => mockLlm, agentsRepo: { linkedSkills: async () => [] },
  repoIntel: {...} }`) and cast `as unknown as Container`, same pattern already used in
  `indexer-pipeline.test.ts`/`repo-intel-resync.test.ts`.
- `reviewer-core`'s `ReviewOutcome.assembly` (`PromptAssembly`,
  `vendor/shared/contracts/trace.ts`) exposes `callers`/`repo_map`/`pr_description`/`intent` as
  separate nullable fields, not just the merged `user` string — a test asserting "enrichment
  section present/absent" (e.g. repo-intel on/off gating) can check `outcome.assembly.callers`/
  `.repo_map` directly instead of grepping the assembled prompt text for markdown headers, which
  is more robust to future prompt-formatting changes.

- A per-route `config: { rateLimit: {...} }` object (the pattern `POST /pulls/:id/review` and the new `POST /repos/:id/review-diff` both use) is UNOBSERVABLE behaviorally in an `.it.test.ts`: `src/app.ts` only registers `@fastify/rate-limit` when `config.nodeEnv !== 'test'`, so under `NODE_ENV=test` the route's `config.rateLimit` object is inert JSON — no header, no 429, ever. Fastify's public `app.findRoute()` also can't help: its TS type is `Omit<FindMyWayFindResult, 'store'>`, deliberately excluding the one field (`store.config`) that would hold it. The only way to actually assert "this route declares 10/min" in a test is a source-level check (read `routes.ts`, regex the block after the route's URL literal for the `rateLimit:` config) — not a live HTTP assertion. Don't spend time trying to trigger a real 429 in a hermetic/integration test for a route-level rate limit; it structurally can't happen under the test config.
- `agents.ciFailOn` defaults to `'critical'` at the schema level (`db/schema/agents.ts`, `.notNull().default('critical')`) and the seed's built-in agents don't override it — so any test asserting `countBlockers(findings, agent.ciFailOn)` against seeded agents can assume `'critical'` without a DB round-trip to check. The seed also grew from 3 to 5 built-in agents (`seedAgents` + `newAgents` in `db/seed.ts`, all provider `openrouter`/`DEFAULT_PROVIDER`) since the original A2 tests were written — any new `.it.test.ts` asserting "N results for N enabled agents" against the default seeded workspace should assert `toBeGreaterThanOrEqual(2)`, not an exact count, or it will break the next time the seed roster grows.

- When a prior feature (e.g. the shipped `blast_summary` `FeatureModelId`) exists only as UNCOMMITTED work in the main checkout (see the worktree-isolation entry above), syncing just the feature's own module directory into a fresh worktree is NOT enough — its transitive registration in `vendor/shared/contracts/platform.ts` (`FEATURE_MODELS`/`FeatureModelId` union) is a separate uncommitted diff and typecheck fails at the *consumer* call site (`blast/service.ts` calling `resolveFeatureModelForRepo(..., 'blast_summary')`) with a union-type error that doesn't mention `platform.ts` at all. Always `diff <main>/path <worktree>/path` on the vendored contract files too, not just the feature's own module files, before assuming a worktree sync is complete.
- Adding a required field to a widely-shared vendored contract (e.g. `prior_prs` on `BlastRadius`) can break test fixtures OUTSIDE the module the plan calls out. `server/test/contracts.test.ts` is a generic, cross-cutting fixture-round-trip test (parses hardcoded literals for every `PrBrief` building block in one file) — it broke on the same `BlastRadius.parse(...)` requirement the plan's spec correctly flagged for `blast/helpers.test.ts` but didn't mention for this file. Before adding a required field to a shared contract, grep the WHOLE repo for `<Contract>.parse(` / hardcoded literal objects of that shape, not just the module-adjacent test file — a plan's file list can miss a shared fixture test that happens to hardcode the same contract.

- **`SimpleGitClient` (`adapters/git/simple-git.ts`) is architecturally a strict READ-ONLY mirror — there is no write path at all.** `GitClient` exposes only `clone/fetch/diff/blame/log/readFile`; there is no `writeFile`/commit/push method anywhere in the interface. `sync()` (`simple-git.ts:78-85`) advances the clone with `git fetch` + `git reset --hard origin/<branch>`, with an explicit code comment that this is "safe here because we never commit to or run code from the clone." ⇒ Any future feature that tempts an "edit this file from the UI and save it" affordance on repo content (e.g. a spec/doc editor) CANNOT persist that edit by writing into the clone on disk — the next `sync()`/resync job will silently `reset --hard` it away with no error, no warning, and no trace. Real persistence needs either a DB-side override table (content never touches the git clone) or genuine git write-back (commit + push, its own much bigger feature: branch/PR strategy, a write-scoped `GITHUB_TOKEN`) — there is no cheap middle ground. Found while scoping the Project Context feature's Edit tab (`server/specs/SPEC-01-project-context.md`); resolved there by dropping Edit entirely (view-only) rather than building either alternative.

## Tool & Library Notes

- In this sandbox environment, `testcontainers` cannot start a Postgres container even though
  `docker info`/`docker ps` succeed (the daemon here is a Rancher Desktop / k3s-backed context,
  not a strategy testcontainers' auto-detection recognizes) — every `*.it.test.ts` fails at
  `startPg()` with `Could not find a working container runtime strategy`, including pre-existing
  ones (`reviews.it.test.ts`) with no relation to whatever you just wrote. This is an environment
  limitation, not a code regression — don't debug your new integration test's logic in response to
  this error; verify correctness by close reading + the hermetic unit suite instead, and note in
  your summary that the `.it.test.ts` couldn't be executed here.
- `GET /agents` and `GET /agents/:id` do NOT populate linked skills — `skills` is always absent. Use the separate `GET /agents/:id/skills` endpoint to inspect skill links. The seed's `agentSkills` inserts with `onConflictDoNothing` are order-dependent: if the referenced agent doesn't exist when the seed first runs, re-run the seed after adding the agent entry.
- Drizzle aggregate pattern for list-with-count: `db.select({ agent: t.agents, skill_count: count(t.agentSkills.skillId) }).from(t.agents).leftJoin(t.agentSkills, eq(...)).groupBy(t.agents.id)` then `.map(({ agent, skill_count }) => ({ ...agent, skill_count }))`. The `toAgentDto` helper accepts `AgentRow & { skill_count?: number }` — existing single-row callers (`getById`, `update`) keep passing plain `AgentRow` and get `skill_count: undefined` with no type error.
- Adding a field to `RunStats` (and anything else inside the `run_traces.trace` **jsonb document**) must use `.nullish()`, NOT `.nullable()`: historical trace docs predate the field, and `GET /runs/:id/trace` returns the stored JSON as-is (no response Zod schema, no migration of old docs), so a required/`nullable` field would type-mismatch on old rows. `RunSummary`/table-backed columns can stay `.nullable()` since the repo maps every column explicitly. (Per-run cost feature, 2026-06-20.)

## Recurring Errors & Fixes

- Multi-agent step execution: an isolated git worktree does NOT see a prior "done" plan step
  if that step's output only exists as UNCOMMITTED changes in the main checkout (`git status`
  dirty there) — `git worktree` only shares committed refs, never another checkout's working
  tree/index. Symptom: a file/table/migration the plan says "already exists" (e.g.
  `repo_feature_models` / `schema/repo-settings.ts`) is simply absent from your worktree, and
  `pnpm typecheck` fails to resolve it. Fix: `diff <main>/path <worktree>/path` on the specific
  dependency files to confirm the delta is exactly the prior step's declared output (nothing
  extra), then copy just those files into the worktree before starting your own step — don't
  redesign schema you were told is already done.
- A DIFFERENT variant of the above (2026-07-15, SPEC-01-onboarding step 2): a prior step CAN be
  fully committed on the feature branch (e.g. `c0fa6ee` "Integrate step 1: ...") while the current
  worktree's own branch tip is still an ANCESTOR of it (`git log -1` shows an older commit, and
  `git merge-base --is-ancestor <mine> <expected>` confirms it) — this happens when the worktree
  was created before the prior step's integration commit landed on the shared branch, not because
  anything is uncommitted. Diagnostic: `git merge-base --is-ancestor <worktree-HEAD> <expected-sha>`
  succeeding (not the reverse) means it's safe to fast-forward. Fix, when `git status` is clean and
  the worktree has no commits of its own beyond the stale tip: `git merge --ff-only <expected-sha>`
  — a plain fast-forward, no rebase/merge-commit needed, since there's no divergent local history
  to reconcile. Always verify with `git status`/`git log --oneline -1` first that the worktree truly
  has zero unique commits before doing this; if it did, `--ff-only` would simply refuse and a real
  rebase/merge decision would be needed instead.
- The `...(cond ? { field } : {})` conditional-spread pattern used to pass optional prompt
  fields to `reviewPullRequest(...)` in `run-executor.ts` bypasses TypeScript's excess-property
  check: `pnpm typecheck` stays green even if `reviewer-core`'s `ReviewInput` doesn't yet declare
  that field (e.g. wiring in `intent` before `reviewer-core`'s `intent?:` field lands). This means
  a producer-side wire-in can silently compile against a stale consumer type — the field is
  passed at runtime but does nothing until the consumer type/logic actually reads it. Don't treat
  a clean typecheck here as proof the consumer package already supports the new field.
- The `tokens ≈ chars / 4` heuristic is NOT exported anywhere reusable — it's inlined
  (`adapters/tokenizer/index.ts::approxTokens`, operating on a `string`) with no exported divisor
  constant. A pure domain module that needs the same heuristic on precomputed char COUNTS (not a
  string to re-encode) can't cleanly import it: `approxTokens` takes text, and importing from
  `adapters/*` into a pure `modules/<x>/helpers.ts` also crosses the onion layering (adapters are
  outer-layer I/O-adjacent code). Resolution used in `modules/intent/helpers.ts`: re-declare the
  tiny `Math.ceil(chars / 4)` formula locally with a comment citing the mirrored location, rather
  than importing the adapter or reconstructing a dummy string of that length just to call it.
- `container` has no `.logger` — the established pattern for a service method that wants
  structured logging on an ad-hoc call (not a full `agent_run`) is an OPTIONAL `logger?: Logger`
  parameter (minimal pino-compatible shape: `info/warn/error(obj, msg?)`), passed by the route as
  `req.log` (mirrors `ReviewService.runReview(workspaceId, prId, targets, logger)` /
  `reviews/routes.ts`'s `req.log` argument). Don't invent a container-level logger getter.
- `pnpm db:generate` diffs against the ENTIRE current schema state, not just the file(s) you just
  edited. If it proposes a change unrelated to what you touched, don't assume it's real
  never-migrated drift — it may be stale/corrupted snapshot metadata instead (see the
  `0011`/`0012`/`cost_usd` entry above; that's exactly what happened here, and generating a
  catch-up migration for it was the WRONG fix, later reverted). Genuinely isolating your own
  change is still good practice regardless: temporarily move your new schema file(s) out, run
  `db:generate` once to see what (if anything) it proposes on its own, restore your file(s), then
  `db:generate` again — a real pre-existing drift will show up isolated in the first run; a
  snapshot-metadata bug will make the first run propose a change to a column that a `git log`
  on the actual migration files shows was already added and applied.
- `cd server && pnpm typecheck` fails with `Cannot find module 'openai'/'zod'` inside `../reviewer-core/src/**` if `reviewer-core/node_modules` was never installed in that checkout/worktree. Server's `tsconfig.json` path-aliases `@devdigest/reviewer-core` straight to `../reviewer-core/src`, pulling reviewer-core's source (and its own `openai`/`zod` deps) into the server's `tsc` program; server's own `node_modules` does NOT satisfy that resolution since reviewer-core is a sibling package with its own lockfile, not a parent. Fix: `cd reviewer-core && npm install` once per checkout/worktree — reviewer-core is the one package of the four that uses `npm`/`package-lock.json`, NOT `pnpm` (confirmed by its committed `package-lock.json`; running `pnpm install` there instead fabricates a stray `pnpm-lock.yaml`/`pnpm-workspace.yaml` that should be deleted, not committed).

## Session Notes

- 2026-06-22: added `findings_by_severity` to `PrMeta` + `GET /repos/:id/pulls` route; removed the prior "intentionally not surfaced" comment that blocked this.
- 2026-06-22: added `PrFindingSummary` type + `findings` field to `PrMeta` for PR-list tooltip; single extended JOIN query builds both the severity-counts map and the capped findings list in one DB round-trip.
- 2026-06-24: Skills feature spec written (server/specs/skills.md). Audited existing scaffold: DB tables, shared contracts, agentsRepo skill-linking methods, and reviewer-core prompt assembler are all in place. Gap: `modules/skills/` missing, `agent_skills.enabled` column missing, run-executor passes `skills: null` unconditionally. Spec covers 10 implementation steps in order.
- 2026-06-25: Full server-side skills implementation: migration 0011 (agent_skills.enabled), modules/skills/ (repository/service/routes), @fastify/multipart + adm-zip for file import, run-executor wire-in, AgentSkillLink contract updated in both vendored copies, seed extended with 4 skills + 2 new agents. Client: lib/hooks/skills.ts written; UI components in fork agent.
- 2026-06-26: Conventions Extractor built end-to-end: migration 0012 (evidence_line), modules/conventions/ (repository/service/routes), feature model default openrouter/deepseek-v4-flash, extraction returns 13 validated candidates from ai-stock-app. API Contract Reviewer agent seeded with 5 skills. Client conventions page + hooks + components complete; experiment (skills-off vs skills-on) deferred.
- 2026-07-03: Added `skill_count` to `GET /agents` via LEFT JOIN + `count()` + `groupBy` in `AgentsRepository.list()`; `toAgentDto` made optional on `skill_count` so non-list callers need no change. Both vendor `Agent` contracts updated (server + client).
- 2026-07-04: Intent Layer feature spec written (server/specs/intent-layer.md), cross-package (server + reviewer-core + client). Audited existing scaffold first: `pr_intent`/`pr_brief` tables, `Intent` shared contract, `getIntent`/`upsertIntent` (zero call sites), `FEATURE_MODELS.review_intent` entry (wrong default: openai/gpt-4.1), `resolveFeatureModel`, and end-to-end linked-issue resolution in the GitHub adapter were ALL already in place — none of it wired to anything. Plan's real net-new work: flash default, a new `repo_feature_models` table + resolver for per-repo model override, `modules/intent/` classifier module, a new `intent` optional prompt slot in `reviewer-core`, and the client Intent card + Settings override UI. 11 execution steps with disjoint file ownership; no code written yet.
- 2026-07-05: Smart Diff feature spec written (server/specs/smart-diff.md), cross-package (server + client). Confirmed the `SmartDiff` contract family already exists unwired (see Codebase Patterns) and that the client's "Files changed" viewer has ZERO grouping/toggle logic today (a plain `.map()` over files) — the reference screenshot's "Smart order" toggle and Core/Wiring/Boilerplate sections are the target design, not a partially-built feature. Plan reuses `ReviewRepository` (no new repo), mirrors `IntentService`'s DI/module shape, and keeps `pseudocode_summary` null everywhere (no LLM call, no producer exists). Passed a dedicated pre-implementation `architecture-reviewer` pass (PASS, one non-blocking INFO about news-up vs container `reviewRepo`) before any code was written — plan-review-before-code caught nothing critical here but is a useful gate for onion-layering mistakes on paper vs in diff.
- 2026-07-05: Smart Diff fully implemented per the spec above: `modules/smart-diff/{constants,helpers,service,routes}.ts` + registration in `modules/index.ts` + `test/smart-diff.it.test.ts` (server); `lib/hooks/smart-diff.ts`, `SmartDiffViewer` component, optional `findingLines`/`highlightLines` props on `FileCard`/`CodeLine`, `lineAnchorId` helper, Smart/Original segmented toggle in `DiffTab.tsx`, and a `["smart-diff", prId]` invalidation in `page.tsx`'s `onRunDone` (client). Server: 128/128 unit tests + typecheck pass; `pnpm db:generate` confirms zero schema drift. The one `.it.test.ts` couldn't actually run in this sandbox (see Tool & Library Notes) but mirrors the already-passing `reviews.it.test.ts` pattern exactly. Note: the plan's proposed test path `smart-diff/routes.it.test.ts` (colocated) was NOT used — the repo's real convention is all `*.it.test.ts` files live flat under `server/test/`, confirmed by grepping every existing one; used that instead.

- 2026-07-09: Blast Radius fully implemented per `server/specs/blast-radius.md` (all 8 steps,
  including the optional LLM-summary step). Server: `repo-intel/blast-reachability.ts` (pure
  2-hop reverse-BFS, see Codebase Patterns correction above) + `tryPersistentBlast` extension +
  per-symbol caller-cap fix, `modules/blast/{helpers,service,routes}.ts`, registered in
  `modules/index.ts`, new `blast_summary` `FeatureModelId` (flash default from the start).
  147/147 server unit tests pass (added ~24 across 4 new test files); the new
  `test/blast.it.test.ts` (6 cases) couldn't run in this sandbox (see Tool & Library Notes
  entry) but was written and typechecked against the real schema. Client: `usePrBlast`/
  `useSummarizeBlast` hooks, `BlastRadiusCard` (compact, Tree-only, on Overview) + `BlastTab`
  (full Tree/Graph, `BlastGraph` is a hand-rolled fixed-column SVG — no new chart dependency),
  wired into `page.tsx`/`PrDetailHeader`/`OverviewTab`, reusing the existing `onOpenInDiff`
  click-to-code mechanism end to end. 41/41 client tests pass. Both `pnpm typecheck` clean.

- 2026-07-12: Wrote `server/specs/blast-radius-nestjs-endpoints.md` fixing the NestJS
  decorator-routing blind spot (see "What Doesn't Work" entry above). Two-phase design: H1
  (`extractNestRoutes`, a new decorator-aware scanner alongside — not merged into —
  `extractEndpoints`, reusing `extractSymbols`'s class/brace-tracking pattern; new
  `file_facts.route_symbols` jsonb column) fixes the "0 endpoints" bug outright and is
  independently shippable. H2 (method-scoped hop-1 attribution in `tryPersistentBlast`, keying off
  `BlastCallerRow.symbol` into `routeSymbols[symbol]` with a fallback to the old file-level
  `endpoints` array when the caller isn't itself a decorated handler) fixes a secondary
  over-attribution problem (a changed symbol reached via ANY caller in a controller file
  currently inherits ALL of that file's routes, not just the calling method's own). Explicitly
  scoped hop-2 (reverse-import reachability) to stay file-level — no per-symbol call data exists
  at that hop by the existing `reverseReachableFiles` design (`server/insights.md`'s 2026-07-09
  correction entry), so precision there was ruled out-of-scope rather than left silently unfixed.
  No code written yet.

- 2026-07-12: Implemented `server/specs/blast-radius-nestjs-endpoints.md` end to end (all 5
  steps, H1+H2). `extractNestRoutes` (`extract.ts`) + new `file_facts.route_symbols` jsonb column
  (migration `0014_spicy_radioactive_man.sql`) + pipeline/repository wiring +
  method-scoped hop-1 attribution in `tryPersistentBlast`. 162/162 unit tests pass (+15 new:
  11 in `extract.test.ts`, 3 in the new `repo-intel-blast-nest.test.ts`), `pnpm typecheck` clean.
  Two real bugs surfaced only by testing against an actual cloned NestJS repo, not caught by
  synthetic fixtures — see "What Doesn't Work" entries above: `METHOD_RE`'s multi-line-signature
  blindness (fixed) and `DepCruiseGraph.buildEdges` dropping most real import edges (found,
  documented, explicitly NOT fixed — out of scope). End-to-end verification against the real demo
  PR (`bagriy-andrey/ai-stock-app` #5) confirmed `route_symbols` now populates correctly for all
  3 PR-relevant controllers post-full-reindex, but `impactedEndpoints` on that specific PR is
  still empty because of the separate `file_edges` gap, not this fix.

- 2026-07-14: Project Context feature spec written (`server/specs/SPEC-01-project-context.md`,
  L05, cross-package server+client+reviewer-core). Audited existing scaffold first, same "already
  built, nothing wired" shape as `review_intent`/`SmartDiff` above: `reviewer-core`'s
  `assemblePrompt` already has a working `specs?: string[]` slot producing a `wrapUntrusted(...)`
  `## Project context` block (`prompt.ts:101-104,146`); `PromptAssembly.specs` and
  `RunTrace.specs_read` already exist in the shared contract (`trace.ts:43,89`); a `SpecFile`
  contract already exists (`platform.ts:278`); client hooks `useContextFiles`/`useReindexContext`
  already call not-yet-built routes (`hooks/core.ts:122-137`). `run-executor.ts` is the actual gap
  — it never passes `specs` and hardcodes `specs_read: []` (`run-executor.ts:254`), so most of this
  feature is wiring, not new engine work. Also found (and will need fixing to match this feature's
  required block order): `assemblePrompt` currently renders `## Repo skeleton` BEFORE
  `## Project context`, deliberately ("model sees structure first", `prompt.ts:50-53,143-146`) —
  the spec requires flipping that relative order. Genuinely net-new: an attachment-storage home
  (no generic `metadata` column exists on `agents` or a skills table today) and a real per-block
  token count in the trace (existing `tokens_in`/`tokens_out` are whole-prompt only). A dead
  RAG/embedding scaffold also exists (`code_chunks` table with `embedding vector(1536)`, an
  `'embedding'` `IndexStatus` phase, gated OpenAI `embed()` behind `embeddingsEnabled` default OFF)
  — explicitly kept OUT of this feature's footer-stats requirement to preserve "zero new LLM
  calls"; don't wire it in when implementing SPEC-01's "Indexed/chunks" footer, that's a
  deterministic doc/heading count, not embeddings. No code written yet.

- 2026-07-15: Implementation Plan for SPEC-01 written (`server/specs/SPEC-01-project-context-plan.md`,
  9 steps, single-agent execution). Confirmed the client run-trace screen (AC-21/AC-22) needs
  **zero new client code**: `client/src/app/repos/[repoId]/pulls/[number]/_components/RunTraceDrawer/_components/TraceBody/TraceBody.tsx:39-51,85-87`
  already renders `trace.specs_read` and `prompt_assembly.specs` — those fields are only ever
  empty today because `run-executor.ts` hardcodes `specs_read: []` and never passes `specs`
  (per the 2026-07-14 entry above). ⇒ For SPEC-01, "Specs read" + the expandable "Project
  context — attached specs" trace block are satisfied purely by the server starting to populate
  data the UI already knows how to display — don't plan any `RunTraceDrawer`/`TraceBody` work for
  this feature. Also newly confirmed net-new pieces (not covered by the 07-14 audit): two
  path-only link tables (`agent_context_docs`, `skill_context_docs`, no `repo_id` — attachment is
  not repo-scoped) + a `repo_context_index` scan-state table, and discovery uses Node 22's
  `fs.readdir({ recursive: true })` (no new glob dependency needed).

- 2026-07-15: `ContextService.resolveEffectiveSpecs`'s `log?: Logger` parameter (`modules/context/service.ts`)
  uses the Fastify `req.log`-style signature (`info: (obj: unknown, msg?: string) => void`, plus a
  required `warn`), NOT `RunLogger`'s shape (`info(msg: string, data?: unknown)`, no `warn` at all —
  only `info`/`tool`/`result`/`error`). Passing a `RunLogger`/`runLog.forRun(...)` instance straight
  into `resolveEffectiveSpecs` as its `log` arg does NOT typecheck (missing `warn`, and the two
  `info` signatures are parameter-order-incompatible, not just differently named) — this bit wiring
  run-executor.ts's Project Context injection (SPEC-01 step 5) to `runOneAgent`. Fix: build a tiny
  inline adapter object `{ info: (obj, msg) => runLog.info(msg ?? '', obj), warn: (obj, msg) =>
  runLog.info(msg ?? '', obj), error: (obj, msg) => runLog.error(msg ?? '', obj) }` (mapping `warn` →
  an `info`-level RunLog event, since `RunEventKind` has no `'warn'` variant) and pass that instead.
  ⇒ Any future service accepting a pino-shaped `Logger` that needs to be driven from `run-executor.ts`
  needs this same adapter — `RunLogger` is not a `PinoLike`/pino-shaped logger despite superficially
  looking like one (both take an optional second arg).
- 2026-07-15: No hermetic test file previously exercised `ReviewRunExecutor.runOneAgent`'s trace-building
  (only `test/reviews.it.test.ts`, real-PG, and `test/agent-runner.test.ts`, which only covers the
  extracted `runAgentReview` helper). Testing `runOneAgent` hermetically requires mocking `ReviewRepository`
  (cast an object literal `as unknown as ReviewRepository`, same pattern as the `agentsRepo` insight
  above) AND `container.git.diff` (otherwise `loadDiff` falls through to `repo.getPrFiles`, which isn't
  mocked, and every run in the test fails with "repo.getPrFiles is not a function" before reaching the
  agent loop at all). Since `ContextService` is `new`'d directly inside `run-executor.ts` (not
  container-injected), asserting its output flows into the trace needs `vi.mock('../src/modules/context/service.js', ...)`
  at module scope (imported before `run-executor.ts` itself, via a dynamic `await import(...)` after the
  `vi.mock` call) — this repo had zero prior `vi.mock` usage anywhere in `server/test/`, everyone else
  uses container-override object literals, but that pattern only works for container-resolved deps, not
  for a class a module `new`s up itself. New file: `test/run-executor.test.ts`.

- 2026-07-15: Implemented `modules/onboarding/` (SPEC-01-onboarding-generator step 3 —
  `constants`/`repository`/`service`/`routes`, registered in `modules/index.ts`). Key
  finding: `OnboardingService.generate()` can be tested hermetically end-to-end (single-
  LLM-call assertion, AC-5/AC-8/AC-9 wiring) WITHOUT a real DB by combining two existing
  patterns rather than inventing a new one — (1) `RepoRepository` (from `../repos/
  repository.js`) is imported directly, cross-module, exactly like `ContextService`
  already does (an accepted exception to the "cross-cutting repos hang off the
  container" rule for this specific shared repo, not just `agentsRepo`/`reviewRepo`);
  (2) after `new OnboardingService(container)`, both `svc.repo` (`OnboardingRepository`)
  AND `svc.repos` (`RepoRepository`) are overwritten post-construction with stub object
  literals, the exact same trick `test/repo-intel-facade-degraded.test.ts` uses for
  `RepoIntelService.repo`. This avoids needing a fake drizzle query-builder chain for
  everything EXCEPT `resolveFeatureModel`, which still reads `container.db` directly
  (`getFeatureModelOverride`'s `select({...}).from(t.settings).where(...)`) — that one
  call site can't be bypassed by overriding a repo field, so the test container's `db`
  must still provide a minimal `{ select: () => ({ from: () => ({ where: async () => [] }) }) }`
  chain (returning no override rows) even though nothing else in the pipeline touches
  `container.db` directly. ⇒ For any future single-LLM-call module service that also
  calls `resolveFeatureModel`, hermetic testing needs this same minimal fake `db`
  regardless of how thoroughly the module's own repositories are stubbed out.
- 2026-07-15: The AC-9 "drop hallucinated `links[].path`" backstop needs a "known paths"
  set built from ALL of this generation's gathered facts, but `getRepoMap(repoId).text`
  (the repo-map skeleton) has no clean parseable list of paths — it's a formatted tree
  string, not an array. `buildKnownPaths` (`modules/onboarding/service.ts`) handles this
  with a best-effort regex extraction (`/[\w.\-/]+\.[A-Za-z0-9]+/g` — anything with a
  file-extension-shaped suffix) over the raw text, unioned with the exact manifest
  filenames used, `getTopFilesByRank`'s paths, and `getCriticalPaths`' flattened chains.
  This is deliberately lossy/best-effort (a link to a real file the regex fails to spot
  in the tree text gets dropped too) but errs toward the spec's stated priority — AC-9
  cares about never rendering an INVENTED path, not about maximizing recall of real ones.

- 2026-07-16: Implemented `modules/brief/` (SPEC-02 step 3 — `constants`/
  `helpers`/`service`/`routes`, registered in `modules/index.ts`). Two
  findings: (1) `MockLLMProvider.completeStructured` (`adapters/mocks.ts`)
  self-validates its configured fixture against the REQUEST's own `req.schema`
  before returning (`schema.safeParse(fixture)`, throwing if it fails) — so
  you CANNOT use the normal `new MockLLMProvider('openai', { structured: {...} })`
  constructor to simulate a service receiving an INVALID structured response
  (e.g. to test an AC-8-style "don't persist on parse failure" path); the mock
  itself refuses to hand back non-conforming data. The working pattern (also
  used by `onboarding.it.test.ts`'s LLM-failure test, but for a REJECTION, not
  a malformed-but-resolved response) is to directly overwrite the instance
  method after construction: `llm.completeStructured = vi.fn().mockResolvedValue({ data: {...garbage}, model, tokensIn, tokensOut, costUsd, raw, attempts })`,
  bypassing the mock's own schema gate entirely. (2) A service that news-up's
  MULTIPLE sibling services in its constructor (mirroring `BriefService`
  composing `BlastService`/`SmartDiffService`/`ContextService` alongside its
  own `ReviewRepository`, all only wrapping `container.db`) can be hermetically
  tested by overriding EACH sibling-service instance field post-construction
  with its own minimal stub object literal (`(svc as unknown as { blast: {...} }).blast = { get: async () => ... }`,
  one per field) — same "overwrite post-construction" trick as `onboarding`'s
  `svc.repo`/`svc.repos`, just applied to N fields instead of 2. This only
  works if the service STORES each sibling as an instance field rather than
  `new`-ing it up inline inside the method body — worth keeping in mind when a
  plan's pseudocode shows an inline `new BlastService(this.container).get(...)`
  one-liner: promoting it to a constructor-assigned field costs nothing at
  runtime and is what makes the service testable without a real DB.

## Open Questions

- API Contract Reviewer experiment (skills-off vs skills-on) not yet run — needs a breaking-change PR in a cloned repo + two review runs to compare.
