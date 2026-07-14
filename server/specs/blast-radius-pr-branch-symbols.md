# Spec: Blast Radius — PR-branch-only symbols are invisible

**Status:** implemented (both phases, live-verified against the real demo PR — see the Session
Notes entry in `server/insights.md` dated the day of implementation for full results, including a
newly-discovered, separate ast-grep symbol-extraction bug this fix's discriminator had to route
around).
**Scope:** `server/` only. No client changes — the `BlastRadius` contract shape is unchanged;
only what populates `changed_symbols`/`downstream[].callers`/`endpoints_affected` gets more
complete for a specific class of PR.

**Relationship to prior work:** distinct root cause from `server/specs/blast-radius-nestjs-
endpoints.md` (that spec fixed decorator-route DETECTION; this fixes symbol VISIBILITY). Both
were diagnosed on the same real PR (`bagriy-andrey/ai-stock-app` #5) and are documented as
separate compounding traps in root `insights.md`'s "Blast Radius has two independent staleness
traps" entry (plus its two 2026-07-12 field-confirmation addenda) and `server/insights.md`. Read
those first — this file is the fix for the second field confirmation specifically ("a brand-new
PR-branch-only FILE is invisible even when `pr_files` is fully correct").

---

## 0. The bug, precisely (confirmed on a real PR, not hypothesized)

`bagriy-andrey/ai-stock-app` PR #5 adds a brand-new file, `apps/api/src/auth/
get-authenticated-user-id.ts` (`status: "added"` per the GitHub API), exporting one function,
`getAuthenticatedUserId`, which ~6 controllers now import and call. Blast Radius's
`changed_symbols` for this PR (verified via direct `GET /pulls/:id/blast` and DB inspection)
**never includes `getAuthenticatedUserId` at all** — not stale, not wrong, simply absent, because:

- `tryPersistentBlast` (`server/src/modules/repo-intel/service.ts:317-`) computes `changedSymbols`
  from `this.repo.getSymbolRows(repoId, changedFiles)` — a query against the `symbols` table
  (`repository.ts:491-505`).
- The `symbols`/`references` tables (`server/src/db/schema/context.ts:61-118`) have **no sha/ref/
  branch column** — they hold exactly one "current index snapshot" per repo, keyed only by
  `(repoId, path, name, kind, line)`.
- That snapshot is built exclusively from `origin/<defaultBranch>` — `resyncRepo`
  (`repo-intel/service.ts:145-164`) does `container.git.sync(ref, repo.defaultBranch)`, and
  `container.git.clonePathFor(repo)` (`adapters/git/simple-git.ts:37-39`) is a function of
  `{owner, name}` ONLY — there is exactly **one mutable working-tree location per repo**, always
  checked out to the default branch. `get-authenticated-user-id.ts` exists solely on the PR's
  `update-api` branch, was never merged, so it was never cloned, never parsed, never has ANY row
  in `symbols` — there is nothing to become stale; it was never indexed once.
- The same ceiling applies to the "degraded"/ripgrep fallback path
  (`repo-intel/service.ts:244-296`): `container.codeIndex.symbols(ref)`
  (`adapters/codeindex/ripgrep.ts:46-48`) also resolves via `clonePathFor(repo)` — the identical
  single default-branch clone. There is no code path anywhere in `getBlastRadius` that can see
  PR-branch-only content today.

## 1. What already exists that this fix can reuse (do not rebuild)

| Artifact | State | Location |
|---|---|---|
| `pr_files.patch` | **Already populated**, already synced on every `GET /pulls/:id` (with `GITHUB_TOKEN`). Contains GitHub's own unified-diff hunk text per file — for a `status: "added"` file this diff hunk header is `@@ -0,0 +1,N @@` and its body IS the entire file, every line prefixed `+`. Fetched straight from `octokit.rest.pulls.listFiles(...)`'s `f.patch` (`adapters/github/octokit.ts:79-84,106-111`) — no clone involved. GitHub omits/truncates `.patch` for very large or binary files (~300+ changed lines) — a real, acceptable degradation case (see §5). | `server/src/db/schema/pulls.ts:36-45` |
| `extractSymbols`/`extractReferences`/`extractNestRoutes`/`extractEndpoints`/`extractCrons` | Already the exact functions the real indexer runs per file, all pure (content in, structured data out), already unit-tested. This fix's whole job is feeding them PR-branch content instead of a git checkout — zero new parsing logic needed for the "added file" case. | `server/src/adapters/codeindex/extract.ts` |
| `BlastService.get()` | Already reads full `prFiles` rows (`this.repo.getPrFiles(prId)`, includes `.patch`) — currently only forwards `files.map(f => f.path)` to `repoIntel.getBlastRadius`, discarding `.patch`. This is the one call site that needs to start passing patch text through. | `server/src/modules/blast/service.ts:59-65` |
| `getBlastRadius(repoId, changedFiles)` | PR-agnostic signature by design (`repo-intel` doesn't know about PRs — `changedFiles` is just a bare path list). This fix adds an OPTIONAL third argument carrying "extra content hints per path," a generic extension that preserves that boundary — repo-intel still never imports `pr_files`/`ReviewRepository`. | `server/src/modules/repo-intel/service.ts:222` |
| Existing "degraded" caller convention | `rank: 0` for callers found outside the persistent rank/decl_file system (`repo-intel/service.ts` degraded-path comment: "ripgrep/degraded path has no persistent rank"). This fix's ephemeral callers/symbols reuse the exact same convention — nothing new to invent. | `repo-intel/service.ts` (ripgrep fallback) |
| `BlastService.get()`'s own docstring | "Never persists anything — every call recomputes from the live index" — this fix's ephemeral (never written to `symbols`/`file_facts`) design is consistent with, not a departure from, the feature's existing philosophy. Persisting PR-branch-only data into repo-scoped tables would actively corrupt them across multiple concurrently-open PRs touching the same path differently. | `server/src/modules/blast/service.ts:49-52` |

## 2. Two phases — ship Phase 1 alone if Phase 2's risk isn't worth it yet

### Phase 1 — make PR-branch-only ADDED files' own symbols/routes visible

**Closes the exact confirmed symptom**: `getAuthenticatedUserId` (or any brand-new exported
function/route in a `status: "added"` file) appears in `changed_symbols`, with its own
`file_facts`-equivalent (endpoints/crons if it's itself a route file) computed ad hoc.

**Does NOT yet fix**: callers of that new symbol FROM OTHER files that are themselves part of
this same PR's diff (e.g. the 6 controllers that now import and call
`getAuthenticatedUserId` — those controller files are `status: "modified"`, and their PERSISTED
`references` rows still reflect `main`, which never called this function). Phase 1 alone will
show the new symbol with `callers: []` — correctly reflecting "no callers on `main`," but not yet
"callers within this PR." That gap is Phase 2.

**1.A `server/src/adapters/codeindex/extract.ts` — reconstruct full content from an "added-file" patch**

New pure function, alongside the other extractors:

```ts
/** True iff `patch` is GitHub's unified-diff hunk for a brand-new file — a single hunk starting
 *  `@@ -0,0 +1,N @@` (old side has zero lines: the file didn't exist before). */
export function isAddedFilePatch(patch: string): boolean

/** Reconstructs the full file content from an added-file patch: drops the `@@ ... @@` header and
 *  any `\ No newline at end of file` marker, strips the leading `+` from every line. Returns null
 *  if `patch` isn't a clean single-hunk added-file patch (be conservative — a null here just means
 *  "skip Phase 1 for this file," not a crash). */
export function reconstructAddedFileContent(patch: string): string | null
```

Test cases (`server/test/extract.test.ts`, new `describe('isAddedFilePatch /
reconstructAddedFileContent')` block): a real added-file patch shape (reuse
`get-authenticated-user-id.ts`'s actual GitHub patch as one fixture — real-world regression case,
same precedent as the NestJS spec's fixture choice), a patch with `\ No newline at end of file`,
a patch that ISN'T added-file-shaped (`@@ -1,3 +1,5 @@`, a normal modification) → `null`, a patch
with multiple hunks → `null` (an added file is always exactly one hunk covering the whole file;
multiple hunks means this isn't a clean add — degrade rather than guess).

**1.B `repo-intel/types.ts` + `service.ts` — optional patch-hint input**

`getBlastRadius`'s signature grows one optional param:

```ts
async getBlastRadius(
  repoId: string,
  changedFiles: string[],
  patchesByFile?: Record<string, string>,   // path -> raw GitHub patch text, PR-branch hint only
): Promise<BlastResult>
```

Threaded into `tryPersistentBlast(repoId, changedFiles, patchesByFile?)` too (the ripgrep/degraded
fallback path is NOT extended in this spec — it already degrades for a different reason (no
persistent index at all) and stacking two degradation layers is unnecessary complexity; Phase 1/2
only apply to the persistent path).

Inside `tryPersistentBlast`, right after the existing `declRows`/`changedSymbols`/`nameSet`
computation from `getSymbolRows`: for each `f` in `changedFiles` with ZERO rows in `declRows`
(`!declRows.some(s => s.path === f)`) AND a usable patch (`patchesByFile?.[f]` present and
`isAddedFilePatch` true), reconstruct content, run `extractSymbols(content)` +
`extractNestRoutes(content)` + `extractEndpoints(content)` + `extractCrons(content)` over it (the
exact same four calls the real indexer pipeline makes per file — mirror `pipeline/full.ts`'s
per-file block, don't reinvent it), and merge the results into `changedSymbols`/`nameSet` and into
an ephemeral `factsByFile` entry for that path (same shape the persisted `getFileFacts` rows
already use — `{endpoints, crons, routeSymbols}` — so the existing hop-1 attribution logic from
`server/specs/blast-radius-nestjs-endpoints.md` §1.E needs ZERO changes to consume it, it just
becomes another entry in the same `factsByFile` map, tagged nowhere as "ephemeral" because nothing
downstream needs to know the difference).

**1.C `blast/service.ts` — build and pass `patchesByFile`**

`BlastService.get()`/`summarize()`: alongside `files.map(f => f.path)`, also build
`Object.fromEntries(files.filter(f => f.patch).map(f => [f.path, f.patch!]))` and pass it as
`getBlastRadius`'s third argument. One-line addition at both call sites (`get()` and
`summarize()` — they duplicate this call today per the existing code, not something this spec
introduces).

### Phase 2 — make callers-within-this-PR visible (optional follow-up, higher complexity)

**Closes the remaining gap**: `getAuthenticatedUserId`'s `callers[]` picks up the 6 controllers
that call it ONLY within this PR's own diff, and (critically) `endpoints_affected` then populates
correctly via the Phase-1-computed `factsByFile`/`routeSymbols` for those SAME controller files
(which — important — likely already have PERSISTED `file_facts` rows from the last full reindex,
since the controllers themselves aren't new; only their CONTENT changed. Phase 2 doesn't need to
re-derive `factsByFile` for modified files, only re-derive whether they now REFERENCE the new
symbol).

**2.A New pure function — apply a unified-diff patch to base content**

`parseUnifiedDiff`/`DiffHunk` (`adapters/git/diff-parser.ts`, `vendor/shared/adapters.ts:175-188`)
deliberately discards hunk line TEXT (keeps only line-number ranges, for prompt "grounding" —
matching finding line-refs to hunks). **Not reusable as-is** — Phase 2 needs the actual `+`/`-`/
context line text to splice. New function, do not extend `parseUnifiedDiff` (different consumer,
different needs — keep them separate, same reasoning as keeping `extractNestRoutes` separate from
`extractEndpoints`):

```ts
/** Applies a GitHub-style unified-diff patch (one file's hunks) to that file's PRE-patch content,
 *  returning the POST-patch content. Returns null on any hunk-context mismatch (base content has
 *  diverged from the patch's assumed base — degrade, don't guess/corrupt). */
export function applyUnifiedPatch(baseContent: string, patch: string): string | null
```

Lives in `adapters/codeindex/extract.ts` or a new sibling file — decide at implementation time
based on whether `extract.ts` is getting too large (it will have grown ~250 lines across both
specs by this point; a new `adapters/codeindex/patch-apply.ts` is the more likely right call).

**2.B `tryPersistentBlast` — reconstruct MODIFIED files' post-PR content, re-scan for new
references**

For every `f` in `changedFiles` that IS a `status: "modified"` file (has existing `declRows`
already — this is the discriminator, no new "status" concept needed since Phase 1 already
distinguishes "zero rows" for added files) AND has a `patchesByFile?.[f]`: read the file's CURRENT
indexed content via `container.git.readFile(ref, f)` (existing `GitClient` method,
`adapters/git/simple-git.ts` — already used elsewhere, e.g. `blame`/review-context resolution;
confirm exact call sites before reusing), apply `applyUnifiedPatch(baseContent, patch)`, and if it
succeeds, run `extractReferences(reconstructedContent, symbolName)` for every `symbolName` in the
(Phase-1-expanded) `nameSet` — add any NEW reference not already present in the DB-sourced
`callerRows` as an ephemeral caller row (`rank: 0`, mirroring the existing degraded-path
convention from §1's table). These ephemeral callers flow through the EXISTING
`cappedCallers`/`MAX_CALLERS_PER_SYMBOL` capping and hop-1 endpoint-attribution logic unchanged —
no new code needed downstream of "produce more `BlastCallerRow`s."

**Base-content assumption and its limit**: `container.git.readFile` reads whatever the single
clone currently has checked out — the default branch, NOT necessarily this specific PR's actual
merge-base commit. For a PR that's behind `main` by unrelated commits touching the SAME file,
`applyUnifiedPatch`'s hunk-context matching will legitimately fail (context lines won't line up)
— by design this degrades to "skip Phase 2 for this file" (§2.A's `null` return), not a crash or
a corrupted reconstruction. Accept this; do not attempt real merge-base resolution (would need
`fetchPullHead`, see §6) in this spec.

## 3. Execution order

1. **Step 1** (Phase 1 core, no dependencies): `extract.ts`
   (`isAddedFilePatch`/`reconstructAddedFileContent`) + tests.
2. **Step 2** (Phase 1 wiring, depends on Step 1): `repo-intel/types.ts` + `repo-intel/service.ts`
   (`getBlastRadius`/`tryPersistentBlast` signature + merge logic) + `blast/service.ts` (build/pass
   `patchesByFile`).
3. **Step 3** (Phase 1 verification, depends on Step 2): hermetic test in
   `server/test/repo-intel-blast-nest.test.ts` or a new sibling file — mock `getSymbolRows`
   returning zero rows for an "added" path, supply a real added-file patch fixture via
   `patchesByFile`, assert the symbol appears in `changedSymbols`. Then live-verify against
   `bagriy-andrey/ai-stock-app` #5: `getAuthenticatedUserId` must appear in `changed_symbols`
   post-fix (no reindex needed — this is computed live, per `BlastService.get()`'s docstring).
4. **Step 4** (Phase 2 core, independent of Steps 1-3's internals but depends on their output
   shape): `applyUnifiedPatch` + tests (fixture: a real GitHub `.patch` for one of the 6 modified
   controllers in PR #5, applied against that file's actual current `main` content, asserted equal
   to the file's actual PR-branch content — fetch both via the GitHub MCP tools already used
   earlier this session, don't fabricate fixtures).
5. **Step 5** (Phase 2 wiring, depends on Step 4): `tryPersistentBlast`'s modified-file rescan.
6. **Step 6** (Phase 2 verification): live-verify `getAuthenticatedUserId`'s `callers[]` now
   includes the real controller call sites on the same demo PR, and `endpoints_affected`
   populates (composing with `server/specs/blast-radius-nestjs-endpoints.md`'s already-shipped
   method-scoped attribution).

## 4. Definition of Done

- [ ] Phase 1: `changed_symbols` for `bagriy-andrey/ai-stock-app` #5 includes
      `getAuthenticatedUserId` (verified live, `GET /pulls/:id/blast`, no reindex required).
- [ ] Phase 1: existing behavior for files the persisted index DOES cover is byte-identical
      (`patchesByFile` is purely additive — a file with `declRows.length > 0` never enters the
      Phase-1 branch at all).
- [ ] Phase 2 (if shipped): `getAuthenticatedUserId`'s `callers[]` includes at least one of the 6
      real controllers from PR #5, and `endpoints_affected` is non-empty for it — composing
      correctly with the already-implemented (this session, uncommitted) NestJS decorator fix.
- [ ] `pnpm typecheck` and `pnpm test` (unit) clean; new tests added per §3 pass.
- [ ] No new DB columns/migrations (`pr_files`, `symbols`, `references`, `file_facts` all
      unchanged) — confirm `git diff` touches no `db/schema/*` or `db/migrations/*` files.
- [ ] No new external npm dependency for Phase 1. Phase 2's `applyUnifiedPatch` is hand-rolled
      (small, bounded hunk-splice) unless implementation discovers a correctness reason to reach
      for a maintained library — note that decision explicitly if made.

## 5. Risks and assumptions

- **GitHub omits/truncates `.patch` for large or binary files** (~300+ changed lines) — Phase 1
  degrades cleanly (`patchesByFile?.[f]` simply absent → file stays invisible, exactly today's
  behavior, not worse). Not fixable without a real fetch/clone of the PR branch — out of scope.
- **Phase 1's `isAddedFilePatch` false-negative risk**: a genuinely-added file whose patch was
  truncated by GitHub, or whose diff GitHub represents unusually (e.g. a rename detected as
  add+delete) won't reconstruct — degrades to invisible, not incorrect. Acceptable.
- **Phase 2's base-content assumption** (§2.B) is the largest correctness risk in this spec — a
  divergent base produces a clean `null` (safe) but silently under-delivers (fewer callers found
  than truly exist) rather than erroring loudly. Worth an explicit `degraded`-style signal if this
  matters to product (not designed here — flag as an Open Question, §7).
- **Cost**: Phase 1 adds up to `changedFiles.length` extra pure-function calls per blast-radius
  request (cheap, no I/O). Phase 2 adds up to `changedFiles.length` extra `git show`/`readFile`
  calls (I/O against the local clone, not GitHub — cheap, no rate limit, but not free either) —
  both still fit `BlastService.get()`'s existing "recomputed live, cheap" contract, but worth a
  perf sanity check on a PR with many (50+) changed files before shipping Phase 2.

## 6. Out of scope (explicit)

- **Real per-PR indexing** (checking out the PR's actual branch/SHA into a separate location,
  persisting a PR-scoped symbol snapshot) — would be the "fully correct" fix (also closes the
  base-content-divergence risk in §5) but is a substantially larger change: needs a
  ref-scoped/commit-scoped schema (new columns on `symbols`/`references`/`file_edges`/
  `file_facts`, or a wholly separate table family), a second mutable clone location or git
  worktree per open PR (`fetchPullHead` exists, `simple-git.ts:72-75`, but is currently dead code
  landing in the SAME shared clone dir — reusing it safely needs worktree isolation, not just
  calling it), and a lifecycle story for cleaning up PR-scoped state when a PR closes/merges. This
  spec's patch-derived-content approach is deliberately a lighter, lower-risk alternative that
  reuses 100% of the existing extraction pipeline with zero schema changes.
- **`DepCruiseGraph.buildEdges` dropping real import edges** — separate, independently confirmed
  bug (`server/insights.md`'s "What Doesn't Work" entry, 2026-07-12) that ALSO blocks hop-2
  reachability on the same demo PR, unrelated to symbol visibility. Not attempted here.
- **Renamed/removed symbols on the PR branch** — e.g. if the PR renames or deletes a function that
  still exists on `main`, `changed_symbols` will still show the OLD (main) version, not "this
  symbol no longer exists." Genuinely fixing this needs the same real-per-PR-indexing
  infrastructure as above; out of scope here.

## 7. Open Questions

- Should a blast-radius response ever surface "this PR touches N files patch-derived/best-effort,
  not from the full index" as a UI-visible signal (mirroring the existing `degraded`/
  `degraded_reason` fields), so a reviewer knows Phase 1/2 data has a different confidence level
  than fully-indexed data? Not designed here — flag for product input before implementing.
