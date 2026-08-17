# root — insights (cross-cutting / monorepo)

> Durable, non-obvious learnings that span packages (vendored `shared` sync, `scripts/dev.sh`,
> the 4-separate-lockfiles setup, the `.it.test.ts` split). Module-specific facts go in that
> module's `insights.md`. Maintained via the `engineering-insights` skill: append-only,
> deduplicated, substance only. Read before working; empty sections are expected, not a bug.

## What Works

## What Doesn't Work

- **A root-level orchestration script (e.g. `package.json`'s `verify:l06`, added for the Eval
  Pipeline feature) must invoke `reviewer-core` via `npm --prefix reviewer-core`, never `pnpm --dir
  reviewer-core` — mixing package managers across this repo's 5 independently-lockfiled packages
  breaks silently, not loudly.** `reviewer-core` is the one package that uses `npm`/`package-lock.json`
  (already documented in `server/insights.md` re: `pnpm install` there fabricating a stray
  `pnpm-lock.yaml`/`pnpm-workspace.yaml`) — but the same failure isn't limited to an explicit
  `pnpm install`: running ANY `pnpm --dir reviewer-core <script>` (e.g. `typecheck`) triggers pnpm's
  own pre-run dependency-status check, which fabricates the same stray lockfile/workspace files and
  can additionally hit pnpm's build-script-approval gate (`[ERR_PNPM_IGNORED_BUILDS]` for
  `esbuild`) — a hard failure with a confusing error, not an obvious "wrong package manager" message.
  Fixed in `verify:l06` by switching to `npm --prefix reviewer-core run typecheck` / `npm --prefix
  reviewer-core test`; the stray `reviewer-core/pnpm-lock.yaml`/`pnpm-workspace.yaml` files must be
  deleted (git-untracked, safe to remove) if this is ever hit again. ⇒ Any future root-level script
  spanning this repo's packages must pick `npm --prefix <dir>` vs `pnpm --dir <dir>` per-package
  based on which lockfile that package actually commits — never assume pnpm uniformly, despite 4 of
  the 5 packages using it.

## Codebase Patterns

- **This checkout's git remote pointing at the course upstream (`ai-agentic-engineering-neo/dev-digest`) is named `course`, not `upstream`** — lesson docs/screenshots (e.g. the lesson-7 "how to pull in `agent-runner`" instructions) say `git fetch upstream` / `git checkout upstream/<branch> -- <dir>`, but this repo has three remotes (`course`, `ivan`, `origin`) and no `upstream` at all; running the doc's commands verbatim fails with "unknown revision." ⇒ When following course-lesson git instructions here, substitute the actual remote name — check `git remote -v` first rather than assuming `upstream` exists. ref: 2026-08-15 lesson-7 agent-runner pull.

- The **Planner/Implementer subagent pair** (`.claude/agents/planner.md`,
  `.claude/agents/implementer.md`) relies on **disjoint file ownership per
  plan step**, not `isolation: worktree` alone, to make parallel Implementer
  runs safe. `isolation: worktree` only isolates each instance's *working
  copy* — it does nothing to stop two steps from being planned to touch the
  same file, which would just surface as a merge conflict later. The actual
  safety guarantee has to come from the Planner declaring non-overlapping
  file lists per step in the plan's Execution Order section. ⇒ Any future
  parallel-subagent orchestration in this repo needs that same constraint
  enforced at the planning stage, not assumed from git-worktree isolation.

- **An `implementer` finishing a step and reporting file-by-file success does NOT mean its worktree has a commit** — on `/sdd-build`'s Eval Pipeline run (5 of 5 dispatched implementers so far), every single one left its changes staged-or-modified but **uncommitted** in its own worktree, despite fully completing its declared file list and reporting typecheck/test results. `git merge --no-ff <worktree-branch>` on an uncommitted worktree silently reports **"Already up to date"** (the branch tip genuinely has no new commit) — this looks like a no-op merge, not an error, so it's easy to mistake for "nothing to integrate" instead of "the work exists only in an uncommitted working tree." ⇒ Before merging any `implementer` worktree branch into the integration branch, always `cd` into that worktree and run `git status` first; if there are uncommitted changes, `git add` + `git commit` them there before merging — do not trust "already up to date" as proof a step produced no changes. This is now a required step in `/sdd-build`'s own integration procedure, not an edge case.

  **2026-08-16 addendum — "Already up to date" has a SECOND, unrelated root cause: the caller's own shell `cd`'d into a worktree earlier and never `cd`'d back.** On `/sdd-build`'s PLAN-04-multi-agent-review run, an earlier step used `Bash` to `cd` directly into an implementer's worktree (`/Users/.../.claude/worktrees/agent-<id>`) to inspect its `git status` — that `cd` had no matching `cd` back, and the Bash tool's cwd **persists across separate tool calls** in the same session. A later, unrelated `git merge --no-ff worktree-agent-<id> ...` call — intended to run from the integration branch's worktree — silently executed **inside that same implementer's own worktree instead**, so it was really running `git merge <this-branch> ` while already on `<this-branch>`: a trivial no-op that also prints "Already up to date," even though the branch had two brand-new, fully committed commits (verified after the fact with `git cat-file -t <hash>` — both existed) and correctly showed as an ancestor-with-new-commits (`git merge-base --is-ancestor HEAD <branch>` was true) once run from the *correct* directory. Symptom that distinguishes this from the original entry above: `git branch --show-current` reports the **worktree's own branch name**, not the integration branch, at the moment "Already up to date" prints. ⇒ Before trusting "Already up to date" as "nothing to merge," always check `pwd`/`git branch --show-current` first — if a prior command in the same session `cd`'d into another worktree, the shell may still be sitting there. Prefer running merges with an explicit `git -C <integration-worktree-path> merge ...` (or `cd` back explicitly, verified with `pwd`, immediately after any inspection `cd`) rather than relying on the shell's ambient cwd staying put across a long multi-tool-call session.

- **Running `/sdd-build`'s tier-merge `git checkout <integration-branch>` / `git merge` steps directly in the user's live working directory can silently hang an already-running dev server that watches that same directory.** On this session's Eval Pipeline run, the user had `./scripts/dev.sh` running in another terminal (`tsx watch src/server.ts` + `next dev`) for the whole build. After several `git checkout`/`git merge --no-ff` cycles integrating 9 implementer branches into `eval-pipeline` in that same directory, the user's `tsx watch` process was still alive (correct PID, no crash, no error logged) but had never bound to port 3001 — `lsof -i :3001` showed nothing, `curl` timed out, and the client showed a generic "Cannot reach the DevDigest engine" error with no indication of the cause. A freshly-started `node`/`tsx` process in the same directory bound to 3001 immediately, proving the code/DB were fine — only the long-running watched process was stuck, almost certainly from `tsx watch`'s file-watcher choking on the burst of file creates/modifies/deletes a multi-branch merge produces underneath it while it's mid-restart. ⇒ Symptom to recognize: the watched process's PID is still alive and never crashed, but nothing is listening on its port — check `lsof -i :<port>` before assuming a code/DB problem; the fix is killing and restarting the stuck process (`./scripts/dev.sh` again), not debugging the app. Ideally stop the user's dev server before a `/sdd-build` run touches the shared working directory with git operations, and restart it after.

- Per-run **cost is already computed by `reviewer-core`** end-to-end: `ReviewOutcome.costUsd`
  (number | null) comes from OpenRouter's `usage.cost` extension, with an injected
  `estimateCost(model, in, out)` price-table fallback. It is then **silently dropped at the
  server boundary** — `server/.../reviews/run-executor.ts` destructures only
  `{ tokensIn, tokensOut, grounding }` from the outcome and never reads `costUsd`. The
  `agent_runs.cost_usd` column also once existed and was removed by migration
  `0009_complex_runaways.sql`. ⇒ Surfacing cost in the UI is **plumbing-only** (re-add the
  column, stop dropping the field, expose it in the vendored `shared` contracts —
  `PrMeta`/`RunSummary`/`RunStats`), NOT an engine change and zero extra model calls.
  (PR-list `cost` lives on `agent_runs`, NOT `reviews`, so it needs its own latest-run
  subquery — it can't piggyback the existing latest-`score`-from-reviews query.)

  **2026-07-04 correction: this entire entry is STALE.** Commit `b058639` ("add costs to pr
  review") already did exactly this plumbing: `agent_runs.cost_usd` was re-added by migration
  `0010_cheerful_shard.sql`, `run-executor.ts` now destructures and persists `costUsd`, and it's
  exposed in the vendored `PrMeta`/`RunSummary`/`RunStats` contracts. However, the merge in
  commit `0148df2` (renumbering migrations onto `0011`/`0012`) silently dropped `cost_usd` from
  those two snapshots' `agent_runs` column list (though the actual migration/DB/code all still
  have it correctly) — this caused a separate, confusing `db:generate` bug fixed in this same
  session; see `server/insights.md`'s "What Doesn't Work" entry on the `0011`/`0012` snapshot
  corruption for the full story. Don't re-derive "cost surfacing is unbuilt" from this entry —
  it's done; only the snapshot metadata briefly lied about one column's history.

- `.claude/skills/README.md`'s skill catalog table is **stale**: at least
  `postgresql-table-design` and `pr-self-review` have real, populated skill directories under
  `.claude/skills/` but are not listed in that README's table. ⇒ Don't rely on the README
  table alone to enumerate available skills — glob `.claude/skills/*/SKILL.md` directly when
  it matters whether a skill exists.

- The **"Intent Layer" feature already has partial scaffolding** before any dedicated
  implementation work began: an `Intent` zod schema `{intent, in_scope, out_of_scope}` exists in
  the vendored shared contracts (`.../vendor/shared/contracts/brief.ts`) as part of a composed
  `PrBrief` (`intent`, `blast`, `risks`, `history`); `FEATURE_MODELS` in
  `.../vendor/shared/contracts/platform.ts` already registers a selectable `'review_intent'`
  feature (default `provider: 'openai'`, `model: 'gpt-4.1'` — NOT a flash/cheap model yet);
  `Settings.feature_models` already supports a per-feature model override keyed by
  `FeatureModelId`; `server/src/modules/reviews/repository/pull.repo.ts` already exports
  `getIntent`/`upsertIntent`; `PrDetail` already carries a `linked_issue: IssueMeta` field. ⇒
  Before building an Intent Layer, audit what of this existing scaffolding is wired up
  end-to-end vs. dead/unused code — the "cheap flash-class model" requirement means the
  `review_intent` default in `FEATURE_MODELS` needs to change, not just be read.

- **The "scaffolding exists, nothing wired" pattern (first seen on Intent Layer, above) is now
  confirmed a THIRD time, on Blast Radius** — `contracts/brief.ts` defines `PrBrief` as four
  composed sections (`intent`, `blast`, `risks`, `history`), and at least two of the four
  (`intent`, `blast`) had their full Zod shape pre-built with zero producers/consumers before any
  dedicated implementation work began (Smart Diff is a sibling case, though its contract lives
  outside `PrBrief` proper). For `blast` specifically: `BlastRadius`/`DownstreamImpact`/
  `BlastCaller`/`ChangedSymbol` (`contracts/brief.ts:16-44`, both vendored copies) sat unused
  while the underlying DATA layer (`RepoIntelService.getBlastRadius`,
  `modules/repo-intel/service.ts:220-391`) was already fully implemented and working — the gap
  was purely the HTTP route + response-shape mapper + UI, not analysis logic. ⇒ Before scoping
  ANY future `PrBrief` section (`risks`/`history` are the two not yet built), grep
  `contracts/brief.ts` for the section's contract AND grep the whole repo for producers/consumers
  of it — assume scaffolding-but-unwired is the default state here, not "nothing exists yet."
  Also check whether the section's underlying facade/data layer (repo-intel, github adapter, etc.)
  is ALSO already built for the same reason — it was, both times.

- **2026-07-16 addendum (PR Why + Risk Brief grounding): the "scaffolding exists, nothing wired"
  pattern's unwired artifacts can themselves collide by name, and a second FeatureModelId default
  was found wrong.** Auditing for `specs/SPEC-02-pr-why-risk-brief.md` turned up a `pr_brief` DB
  table (`{pr_id PK, json jsonb}`, `server/src/db/schema/reviews.ts`) with zero writers/readers —
  but this is a DIFFERENT pre-existing artifact from the `PrBrief` zod contract in
  `contracts/brief.ts` (which composes `intent`/`blast`/`risks`/`history`); the two don't
  correspond to each other, and neither corresponds to this new feature's own `Brief` type. Add
  `risk_brief` (an unwired `FeatureModelId`) and the unrelated `WhyTimeline`/`contracts/why.ts`
  git-blame "why" concept, and "brief"/"why"-named things in this repo now form a
  four-way naming cluster (`PrBrief` contract, `pr_brief` table, `risk_brief` model id,
  `WhyTimeline`/`why.ts`) that are NOT the same system. ⇒ Don't assume a "Brief"/"why"-named
  artifact found by grep is the one relevant to whatever brief/why feature is being built — check
  which exact one (table vs. contract vs. model id vs. unrelated feature) before reusing it.
  Separately: `risk_brief`'s registered default is `openai/gpt-4.1`, NOT flash — same wrong-default
  shape as `review_intent` (recorded above), now a SECOND confirmed instance. ⇒ When auditing any
  unwired `FeatureModelId` as part of new-feature scaffolding, always check its registered default
  needs correcting to a cheap/flash SKU — an existing registry entry existing is not evidence its
  default is sane.

- **2026-07-28 addendum (Eval Pipeline, `specs/eval-pipeline.md`): a FOURTH confirmed instance,
  and one new wrinkle — a mechanism built years-early with the consuming feature's name already
  in its own code comment.** `eval_cases`/`eval_runs` tables (`server/src/db/schema/eval.ts`) and
  their full Zod contracts (`EvalCase`/`EvalRun`/`EvalCaseInput`/`EvalRunRecord`/`EvalDashboard`
  etc., both vendored copies) existed with zero readers/writers, same shape as Intent/Blast/
  Smart-Diff/PrBrief above. The new wrinkle: `agents.version` + `agent_versions` (immutable config
  snapshots on every agent edit) is not just unwired scaffolding but a FULLY WORKING, actively-used
  mechanism (`GET /agents/:id/versions` already exists) whose own repository code comment says
  *"config into agent_versions (reproducibility for eval)"* — i.e. a past lesson deliberately
  over-built a working feature in anticipation of a not-yet-built later one, rather than leaving
  dead scaffolding. ⇒ When auditing for "what already exists" on a new feature, don't assume every
  precedent artifact is inert scaffolding — check whether an existing, fully-working mechanism in
  an unrelated-looking module (here: agent config editing) was already built with this feature's
  needs in mind, and reuse it as-is rather than building a parallel versioning/snapshot system.
- **2026-08-15 addendum (Multi-Agent Review spec grounding, `specs/SPEC-03-multi-agent-review.md`):
  a FIFTH confirmed instance, with the contract's own JSDoc already documenting the feature's
  business rule.** `server/src/vendor/shared/contracts/observability.ts` (mirrored in the client's
  vendored copy) already defines `MultiAgentRun`/`AgentColumn`/`AgentColumnFinding`/`Conflict`/
  `ConflictTake` (plus `AgentStats`/`StatPoint`/`CuratorMerge`/`CuratorResult` for a later,
  still-unbuilt Per-Agent-Stats / memory-curator feature) — response shapes for
  `POST /pulls/:id/multi-agent-run`, `GET /pulls/:id/multi-agent`, `GET /agents/:id/stats` —
  attributed in the file's own header comment to a contributor "A5," with zero server routes or
  client consumers anywhere in the repo. The `Conflict` type's JSDoc already states the cross-agent
  grouping rule verbatim ("a file:line that at least one agent flagged and at least one other agent
  that also reviewed did NOT, OR where agents assigned divergent severities") — the business-logic
  decision was pre-recorded in a doc-comment, not just the response shape. Matches the
  `multi_agent_runs` DB table stub (`id, workspace_id, pr_id, ran_at`, no FK to `agent_runs`) — same
  unwired-scaffolding shape as Intent/Blast/PrBrief/Eval-Pipeline above. Separately (not part of the
  pattern, but found in the same audit): `RunRequest` (`POST /pulls/:id/review` body) only supports
  `{agentId}` (one) or `{all: true}` — no arbitrary-subset selection exists yet, needed for a
  multi-select agent picker. ⇒ When scoping this feature, read the `Conflict`/`ConflictTake` JSDoc
  as the authoritative match-rule spec before inventing a new one, and treat `AgentStats`/
  `CuratorResult` as reserved names for a LATER feature, not something to build now.

  (frontmatter `name: implementation-planner`) and its scope was tightened: it never authors or
  redefines product requirements/specs, only turns already-defined requirements into a build
  breakdown.** It still writes to `<module>/specs/*.md` (that path convention didn't change) and
  still reads existing specs there as the source of truth for WHAT, but the doc it produces is
  titled `# Implementation Plan: <Feature>`, not `# Spec: <Feature>`. It also now (a) posts
  requirement gaps/recommendations as chat output, separate from the plan file, and (b) asks the
  user to choose multi-agent (parallel Implementer dispatch) vs. single-agent (one sequential pass)
  whenever the step breakdown has ≥2 independent steps, recording the choice as `**Execution
  mode:**` at the top of the plan. ⇒ Other files that still say "planner"/"planner.md" (`README.md`,
  `implementer.md`, `plan-verifier.md`, `doc-writer.md`) were deliberately left unchanged (explicit
  user scope decision) — don't treat their "planner" references or the word "spec" in their prose
  as contradicting this rename; they're just not yet updated to match.

- **Vendored `@devdigest/shared` has TWO physical copies, not three — and the client UI reads a
  THIRD, non-vendored registry.** `reviewer-core/tsconfig.json` aliases `@devdigest/shared` to
  **the server's** `server/src/vendor/shared` (not its own copy). So editing a contract under
  `server/src/vendor/shared/**` (e.g. `contracts/platform.ts`, `contracts/trace.ts`) covers BOTH
  server AND reviewer-core; only `client/src/vendor/shared/**` needs hand-mirroring. Separately,
  the **client UI renders `FEATURE_MODELS` from `client/src/lib/feature-models.ts`**, NOT from the
  vendored copy (importing a runtime VALUE from vendored shared breaks Next's webpack resolution —
  see the comment in that file). ⇒ A user-visible feature-model default change must edit
  `client/src/lib/feature-models.ts`; the vendored client copy is types-only for the UI. (These
  two client files have already drifted for the `conventions` entry — don't assume they match.)

- **Blast Radius has two independent staleness traps, not one** — a PR that gets new commits
  pushed after its first Blast Radius view can show stale data for two unrelated reasons that
  compound: (1) server-side, `RepoIntelService.getBlastRadius` (`server/src/modules/repo-intel/
  service.ts:222`) reads the repo's **persisted index** (`repo_index_state`/`lastIndexedSha`),
  which only advances via a manual `POST /repos/:id/resync` (or a full reindex) — pushing commits
  to a PR branch never triggers it automatically, and `resyncRepo` itself only advances the clone
  to `origin/<defaultBranch>`, not the PR branch. (2) client-side, `usePrBlast`'s query key
  (`["pr-blast", prId]`, `client/src/lib/hooks/blast.ts:10`) is **never invalidated anywhere** in
  `page.tsx` — `onRunDone` deliberately skips it per `server/specs/blast-radius.md:322` ("blast
  radius is diff-derived, not review-run-derived," which is correct for review-run completion),
  but nothing invalidates it when the PR's *files* change either, so with the default 30s
  `staleTime` the UI can sit on a fetch from before the latest push indefinitely if the tab stays
  mounted. ⇒ Fixing "Blast Radius doesn't update" needs both: an automatic (or clearly-surfaced
  manual) reindex trigger tied to new PR commits, AND a `pr-blast` invalidation on PR-detail
  refresh — either alone leaves the other trap in place.

  **2026-07-12 field confirmation + diagnostic signature:** a real case showed a THIRD compounding
  layer: `pr_files` itself (not just the repo-intel index) can be stale, because its refresh
  (`server/src/modules/pulls/routes.ts:251`, delete+reinsert on `GET /pulls/:id`) silently no-ops
  without `GITHUB_TOKEN`/`GITHUB_PAT` configured (`:289`, "serving persisted detail"). The
  observable symptom is diagnostic: Blast Radius's `changed_symbols` count splits cleanly into two
  unrelated groups — symbols matching files in the PR's CURRENT GitHub diff, plus symbols from
  files that aren't in the current diff at all (leftover from an earlier commit/force-push). ⇒ To
  confirm this specific cause (vs. the repo-intel-index trap above), diff the blast panel's symbol
  list against `pull_request_read(method: get_files)`'s actual filenames for that PR — an
  unexplained symbol from a file absent from that list means `pr_files` is holding a stale
  snapshot, point first at whether `GITHUB_TOKEN` is set before assuming a client-cache/index
  problem.

  **2026-07-29 addendum — a token that is SET but INVALID/EXPIRED hits the exact same silent
  degradation path as an unset one, at the PR-LIST level, not just the single-PR `pr_files`
  refresh.** `modules/pulls/routes.ts`'s `GET /repos/:id/pulls` wraps its GitHub sync in a try/catch
  that only logs `app.log.warn({ err }, 'GitHub PR sync skipped (no token / offline); serving
  persisted PRs')` — a 401 from a revoked/expired PAT is caught by this same generic handler as a
  missing token would be, so the app never surfaces "your token is bad" anywhere in the UI; the only
  observable symptom is "the app doesn't see fresh GitHub activity," identical to the unset-token
  case above. ⇒ Before assuming `GITHUB_TOKEN` is simply unset, check it's actually valid: `node -e
  "require('dotenv').config(); fetch('https://api.github.com/user', {headers:{Authorization:'Bearer
  '+process.env.GITHUB_TOKEN,'User-Agent':'check'}}).then(r=>r.text()).then(console.log)"` from
  `server/` — a `401 Bad credentials` response confirms an expired/revoked token, not a code bug.
  `tsx watch` does NOT reload `.env` changes — after rotating the token, the server process must be
  fully restarted, not just left to hot-reload.

  **2026-08-05 addendum — a malformed `.env` line degrades identically to a missing/invalid token,
  with no parse error.** A `server/.env` line like `<stray prose> GITHUB_TOKEN=ghp_xxx` (e.g. text
  accidentally typed/pasted into the file while it was open in an editor, ahead of the `KEY=` token)
  is silently skipped by `dotenv` — it doesn't match dotenv's `KEY=VALUE`-from-line-start pattern, so
  `process.env.GITHUB_TOKEN` ends up `undefined`, hitting the exact same "sync skipped" code path as
  an unset token, with zero indication the `.env` file itself is malformed rather than simply
  unconfigured. The line can visually look fine at a glance (`GITHUB_TOKEN=ghp_...` is present
  in the file) if the stray prefix is off-screen or easy to skim past. ⇒ When diagnosing "token
  configured but sync still skipped," don't just check the value is present — confirm the line
  itself starts exactly with `GITHUB_TOKEN=` (`grep -n '^GITHUB_TOKEN=' server/.env`), not just that
  the substring appears somewhere on the line.

  **2026-07-12 second field confirmation — a brand-new PR-branch-only FILE is invisible even when
  `pr_files` is fully correct.** On the same real PR, after confirming `pr_files` matched GitHub
  exactly (§ above), `changed_symbols` STILL omitted every symbol from a file that was `status:
  "added"` only on the PR's own branch (`get-authenticated-user-id.ts`, never merged to
  `main`) — not stale, just entirely absent, because `tryPersistentBlast`'s `getSymbolRows` reads
  the persisted `symbols` table, which only ever contains what was indexed off
  `origin/<defaultBranch>` (trap (1) above) — a file that exists SOLELY on the PR branch was never
  cloned/parsed at all, at any point, regardless of resync timing. This is a distinct, more
  fundamental failure mode than "stale" data (nothing to become stale — the file was never
  indexed once): any net-new file added within an open PR is structurally invisible to Blast
  Radius's changed-symbol resolution until that PR merges. ⇒ Diagnostic refinement: a symbol
  missing entirely (not just wrong-but-present) from `changed_symbols`, for a file whose `status`
  is `"added"` on the PR, points at this default-branch-only indexing architecture, not at
  `pr_files`/cache staleness — fixing it needs PR-branch-aware symbol resolution (e.g. an
  on-demand extraction pass over the PR's own diff content for files the persisted index doesn't
  know), not just a better resync trigger.

- **`specs/` folders follow a flat, package-scoped convention — NOT a `specs/<module>/`
  subfolder structure.** Packages that have implementation-plan-style specs own them directly and
  flatly: `server/specs/*.md`, `e2e/specs/*.md`. The repo-root `specs/*.md` is ALSO flat and
  reserved only for features that don't belong to any single existing package (e.g.
  `specs/mcp-server.md`, `specs/pre-push-cli.md`) — it is not a parent directory with per-module
  subfolders underneath it. `implementation-planner.md` already hard-codes this layout
  (`<module>/specs/<feature-slug>.md`). ⇒ Any new spec-writing agent/tooling must target this
  exact layout — a `specs/<module>/` subfolder is a plausible-sounding but wrong guess (this was
  the initial, incorrect assumption when designing `.claude/agents/spec-creator.md`, caught only
  by grepping the actual repo before writing the agent).

- **A single `specs/` directory now legitimately mixes two unrelated document types that must
  never be converted into each other:** older Implementation-Plan-style docs with no numeric
  prefix (e.g. `server/specs/skills.md`, `smart-diff.md` — file-by-file HOW breakdowns, written/
  read by `implementation-planner`), and newer `SPEC-NN-<slug>.md` EARS-based feature specs (WHAT/
  WHY, written by the new `spec-creator` agent, numbered per-directory starting at `SPEC-01`). ⇒ A
  spec-writing or spec-reading agent must not assume every file in a `specs/` folder follows one
  shape — check for the `SPEC-` filename prefix before assuming EARS structure, and never rename
  or rewrite a legacy doc into the new format without being explicitly asked to.

## Tool & Library Notes

- **`./scripts/dev.sh` backgrounded via a trailing `&` in an agent shell "completes" almost
  immediately — that only means the wrapper line returned, not that the dev stack stopped.**
  `dev.sh` itself starts the API with `&` (`SERVER_PID=$!`) and then runs the client's `pnpm dev`
  in the FOREGROUND, normally blocking forever with a `trap cleanup EXIT INT TERM` that kills
  `SERVER_PID` on exit. Piping the whole script through `... | tee log &` and backgrounding that
  compound command detaches `dev.sh` as an orphaned process from the invoking shell — the Bash
  tool's own "command completed" notification fires as soon as the two wrapper lines (the launch +
  an echo) finish, while `dev.sh` (and the server/client processes under it) keep running
  independently, invisible to any later `wait`/exit-code check on that task. ⇒ To confirm the dev
  stack is actually still up (or to stop it), check with `ps`/`curl` directly — don't infer
  liveness from the backgrounding task's completion status, and don't assume `kill`ing the
  processes will be caught by `dev.sh`'s own trap-based cleanup once it's been detached like this.

- **`agent-browser` (Vercel's CDP browser CLI) is usable for manual/one-off UI verification** even
  though it isn't preinstalled: `npx -y agent-browser@latest install` downloads a headless Chrome
  (~170MB, one-time), then `npx -y agent-browser@latest --session <name> <cmd>` drives it —
  `open <url>`, `snapshot -i` (interactive-elements-only accessibility tree with `@eN` refs),
  `click @eN`, `get url`, `tab list` (confirms no unexpected new tab opened), `screenshot --full`,
  `close`. Note: its CLI shape is one-shot-command-per-invocation (`agent-browser <cmd>`), NOT the
  stdin-piped multi-line REPL the `run` skill's `examples/playwright.md` shows for `chromium-cli` —
  don't pipe a heredoc script to it, chain separate invocations against the same `--session` name
  instead (the daemon keeps the page alive between calls). `e2e/` already has a real npm dependency
  on this same tool (`@devdigest/e2e`'s `run.ts`) for its deterministic flow specs — this is the
  same binary, just driven ad hoc instead of via `specs/*.flow.json`.

- The `fastify-best-practices` skill's `rules/testing.md` examples use Node's built-in
  `node:test` + `app.inject()`, but this repo's actual server test runner is **vitest**
  (`server/package.json`: `"test": "vitest run"`, vitest `^2.1.8`). Don't copy that skill's
  test-code samples verbatim for `server/` — they'd produce tests that don't fit this repo's
  actual test infra. For server test conventions, use `TESTING.md` + existing examples
  (`server/test/adapters.test.ts` for unit, `server/test/integration.it.test.ts` for the
  `*.it.test.ts`-suffixed real-Postgres pattern) instead of that skill's code blocks.

- **Claude Code's `.claude/settings.json` `permissions.allow` command allowlist is global, not
  scoped per subagent type.** There is no mechanism to grant e.g. only the `implementer` agent
  the ability to run `Bash(npm *)` while withholding it from other agents in the same
  session — an allow rule (`"Bash(npm *)"`, `"Bash(node *)"`, etc.) applies across every
  subagent launched in that session. ⇒ When a request is phrased as "give agent X permission to
  do Y," first surface that the real primitive is a global command-pattern rule (not
  per-agent), and confirm the intended scope (narrow pattern vs. broad) before editing
  `settings.json` — don't silently approximate a per-agent restriction that doesn't exist.

## Recurring Errors & Fixes

- An `isolation: worktree` subagent's branch is forked from whatever commit was HEAD at
  worktree-creation time — it does **not** auto-follow later commits on the base branch, and it
  never sees the base repo's **untracked/uncommitted** files (e.g. a `specs/*.md` plan file that
  exists only as untracked in the main working tree, or sibling agent `.md` files added after the
  worktree's fork point). ⇒ Before concluding a referenced file is missing inside a worktree, check
  whether it exists in the main repo checkout at its absolute path outside `.claude/worktrees/<id>/`
  — read-only references (spec files, precedent agent/skill files) can be read from the main repo
  path even though the step's own deliverable must still be written inside the worktree. Also:
  `implementer`-style agents cannot merge/push their own worktree branch back — the caller must
  manually copy the new file(s) out and integrate them into the main checkout.

  **Corollary when the step's own file list is `(modify)`, not `(new)`, and the whole *package* is
  itself still untracked** (e.g. a brand-new leaf package like `mcp-server/` that another session
  scaffolded directly in the main checkout and never committed): the worktree has NONE of it — not
  even the baseline files the step is supposed to modify — because worktrees only carry committed
  content. `Edit` then refuses ("edit the worktree copy instead of the shared-checkout path") since
  it requires a prior in-worktree `Read`. Fix used successfully by two independent steps in the same
  session: `rsync -a --exclude node_modules --exclude dist <main-checkout>/<package>/
  <worktree>/<package>/` to seed the baseline package, then `npm install`/`pnpm install` inside the
  worktree copy so typecheck/test can run, THEN `Edit` normally. This is legitimate step-scope work
  (materializing pre-existing baseline infra the step depends on), not scope creep — but clean the
  seeded baseline back out of the worktree before finishing, leaving only the step's own declared
  files, so the caller's integration step doesn't mistake sibling-step files (or the whole rsync'd
  package) for this step's output.

  **Subtler variant: a single missing re-export line, not a whole untracked package.** An entire
  "already shipped" feature's source code can be uncommitted-only in the main checkout and thus
  absent from every fresh worktree, including worktrees created for a *follow-up* spec that assumes
  it as baseline (e.g. a `blast-radius-gaps.md` spec whose §0 says `client/src/lib/types.ts` already
  re-exports `BlastRadius` because the parent `blast-radius.md` feature is "implemented" — true in
  the main checkout, false in a worktree forked before that work was committed). Symptom: a step's
  own new files are logically correct and `vitest run` even passes (type-only imports get erased by
  esbuild at runtime, so a missing re-export doesn't fail tests), but `pnpm typecheck` fails on an
  import the step never touches. ⇒ When typecheck fails on a symbol the plan says "already exists,"
  check `git log --oneline -- <file>` / `git diff` in the worktree before assuming your own code is
  wrong — if the symbol is genuinely absent from git history (not just this branch), the worktree is
  missing baseline work that was never committed anywhere; this is a blocker for the caller to fix
  (sync/commit the baseline into the worktree, or verify against the main checkout post-hoc as was
  done here), not something the step's agent should silently patch by editing a file outside its
  declared list.

- **When a task claims prior plan steps are "already merged into the worktree" but a grep for
  their expected symbols comes up empty, the fix can be a plain `git merge` — not a manual
  file-copy — IF a dedicated per-lesson integration branch exists among the sibling worktree
  branches.** Concretely (SPEC-01 step 4, L05): each prior step (1/2/3) had been implemented in
  its OWN throwaway `worktree-agent-<id>` branch, forked straight off the pre-lesson base commit
  and never touching each other; a separate `abahrii-<lesson>` branch (here `abahrii-L05`) had
  already fast-forward-merged all three step commits in order. This worktree's own branch
  (`worktree-agent-<this-id>`) was ALSO forked off that same pre-lesson base commit, so it had
  none of the three steps — `git log --oneline` on it stopped at the pre-lesson merge commit, and
  `git branch --all --contains <step-N-commit>` showed the step's commit only on its own
  throwaway branch plus `abahrii-<lesson>`, never on this worktree's branch. `git merge
  abahrii-L05 --no-edit` fast-forwarded cleanly (zero conflicts, since the integration branch was
  a strict superset). ⇒ Before falling back to the "diff + manually copy files into the worktree"
  fix from the entry above (which is for genuinely UNCOMMITTED prior-step output), first run `git
  branch --all --contains <expected-symbol-file>` or scan `git log --oneline <each-worktree-branch>
  -5` for a per-lesson integration branch name — if one exists and is a strict ancestor-superset,
  a single `git merge` is both correct and much cheaper than reconstructing files by hand.

- The **`github@claude-plugins-official` MCP plugin ignores this project's `GITHUB_TOKEN`/
  `GITHUB_PAT` convention entirely.** Its bundled `.mcp.json` builds the auth header from
  `${GITHUB_PERSONAL_ACCESS_TOKEN}` — a different env var name — and that var must be visible to
  the Claude Code CLI process itself, not just to the app. `server/.env` (where this repo's
  `GITHUB_TOKEN` normally lives) is a Node-only dotenv file the Fastify server reads; the CLI
  process never sources it, so the MCP connection failed with HTTP 400 until
  `GITHUB_PERSONAL_ACCESS_TOKEN` was added explicitly to the harness's own `env` block in
  `~/.claude/settings.json` (global, since it's a personal PAT). ⇒ Don't assume any
  GitHub-auth-flavored Claude Code plugin/MCP server will pick up this project's `GITHUB_TOKEN`
  convention automatically — check the plugin's own `.mcp.json` for the exact env var name it
  expects and set that name separately.

- A background `Agent`-tool subagent (any `subagent_type`, not just `implementer`) can fail
  mid-task with `"You've hit your session limit"` — an account-wide usage cap, not a per-agent
  one — and this can happen after the agent has already made SOME `Edit`/`Write` calls, leaving a
  shared file (e.g. a `specs/*.md` plan another agent or the user is also relying on) partially
  modified: some sections rewritten to a new design, others still describing the old one,
  self-contradictory. The task-notification's `status: "failed"` fires the same as a clean
  failure — there's no signal distinguishing "died before writing anything" from "died mid-edit."
  ⇒ After ANY background-agent failure notification that mentions a session/rate limit, re-read
  the full file(s) it was told to touch before trusting or continuing from them — don't assume a
  failed agent left zero footprint. (Also: don't poll a stalled/still-running background agent by
  repeatedly re-reading its target files or output — that's noisy and rarely tells you more than
  waiting for the actual completion notification; only re-read after a `failed`/`completed`
  notification actually arrives.)

## Session Notes

- **2026-07-16 (SPEC-01-onboarding, 5-step single-agent-per-step pipeline): `.claude/agents/
  implementer.md` never explicitly instructs the agent to `git commit` its work** — step 4 of its
  instructions ("you're running in an isolated worktree... report the step's status; the caller
  handles integrating your branch") silently assumes a commit already exists, but says nothing
  about making one. On this feature's Step 1, the implementer made real `Edit`/`Write` changes in
  its worktree, ran typecheck, and reported success — but never ran `git commit`, so `git merge
  --no-ff <its-branch>` from the integration branch reported "Already up to date" (nothing to
  merge) even though the work existed uncommitted in the worktree's checkout. This compounded with
  a second, independent problem: that worktree's branch point was also stale (predated an
  unrelated already-merged feature that had claimed the same migration number), so the two
  failures together required a full manual reconstruction (diff the uncommitted work, verify it
  was non-conflicting, reapply by hand on the integration branch, regenerate the migration, and
  reconcile a Postgres instance the implementer's stale, uncommitted migration had nonetheless
  already been run against). ⇒ Adding explicit "commit your work before reporting done" +
  "self-check `git merge-base --is-ancestor <expected-base> HEAD`, and if it fails, `git status`
  to confirm no unique commits then `git merge --ff-only <base>`" instructions directly into the
  per-step dispatch prompt (not relying on `implementer.md`'s own wording) fully prevented repeat
  failures on Steps 2–4 of this same feature — each of those implementers independently detected
  its own worktree staleness and self-corrected via `git merge --ff-only` before committing
  cleanly. Any future caller dispatching `implementer` should add these two instructions to the
  per-step prompt explicitly rather than trusting the agent definition's current wording; updating
  `implementer.md` itself to state this by default (not just working around it per-dispatch) is a
  worthwhile follow-up outside this insights file's scope.

## Open Questions

- **No agent currently traces a feature Spec's EARS acceptance criteria (`AC-N`) forward to
  actual test coverage.** `plan-verifier` cross-checks Implementation Plan steps/test-criteria
  against the git diff, but Implementation Plans don't carry `AC-N` IDs, and nothing maps a
  `SPEC-NN`'s `AC-N` list to what `implementation-planner`/`implementer` actually built or tested.
  (Surfaced 2026-07-14 while designing `.claude/agents/spec-creator.md`.)

  **2026-07-16 partial resolution (not automatic — requires explicit instruction):** dispatching
  `implementation-planner` for `specs/SPEC-02-pr-why-risk-brief.md` with an EXPLICIT dispatch-prompt
  instruction to map AC-IDs into step test criteria worked — the resulting
  `specs/plans/PLAN-02-pr-why-risk-brief.md` §3 does cite all 18 `AC-1`…`AC-18` against specific
  steps' test criteria. So the mechanism is possible, but `implementation-planner`'s own default
  behavior (per its agent definition) still does NOT do this unprompted — this remains a real gap
  in the *default* pipeline, just no longer a hard blocker. ⇒ Any caller wanting AC-N traceability
  in a plan must ask for it explicitly in the dispatch prompt, same as this session did, until
  `implementation-planner.md` itself is updated to do it by default.

- **`SPEC-NN` specs have no forward link to the Implementation Plan that realizes them** —
  `Supersedes` only links a spec backward to an older spec it replaces; nothing links a spec
  forward to the plan/PR that implements it, so tracing WHAT → HOW currently requires manually
  finding the matching plan. (Surfaced 2026-07-14 while designing `.claude/agents/spec-creator.md`.)

  **2026-07-16 confirmation this is solved AT THE FILE level, just not automated:** the existing
  `SPEC-01-project-context.md` ↔ `PLAN-01-project-context.md` pair already has this link (the
  spec's `Implementation Plan:` header line points at the plan file) — and `PLAN-02-pr-why-risk-brief.md`
  reproduced it correctly (updated `SPEC-02`'s header from "not yet planned" to the new plan's
  path) when explicitly told to in the dispatch prompt, same caveat as the AC-N note above:
  `implementation-planner` will do this if asked, but nothing forces it, and nothing checks
  afterward that a spec's header actually got updated.
