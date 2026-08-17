# agent-runner Insights

Non-obvious discoveries from real sessions. Specific and actionable — pass the cold-read test.
See also: `insights/gotchas.md` for known quirks at project start.

---

## What Works

2026-07-08 — `ncc build src/index.ts -o dist` fully inlines both `@devdigest/reviewer-core` (raw TS via tsconfig path alias) and `@devdigest/shared` (also a path alias) plus their transitive deps (`zod`, `openai`) into a single `dist/index.js` with zero top-level `import`/`require` statements — verified with `grep -c "^import\|require(" dist/index.js` returning 0. `node dist/index.js` runs standalone. ref: agent-runner/package.json:9

## What Doesn't Work

2026-07-08 — `pnpm typecheck` in `agent-runner` fails with `Cannot find module 'zod'` / `'openai'` errors pointing at `reviewer-core/src/llm/*.ts` if `reviewer-core/node_modules` was never installed. Because this repo is NOT a monorepo (no `pnpm-workspace.yaml`, no hoisting across packages), TypeScript's `moduleResolution: "Bundler"` walks up the ancestor directories of the *importing file* — `reviewer-core/src/llm/` → `reviewer-core/` → repo root — and never reaches `agent-runner/node_modules` (a sibling, not an ancestor). Fix: `cd reviewer-core && pnpm install` once (creates gitignored `node_modules`, touches no tracked files) — this is also required for `cd server && pnpm typecheck` to pass cleanly, so it is not agent-runner-specific. ref: agent-runner/tsconfig.json:20

## Codebase Patterns

2026-07-08 — `agent-runner/tsconfig.json` intentionally mirrors `server/tsconfig.json`'s compiler options and path-alias block verbatim (aliasing `@devdigest/reviewer-core` → `../reviewer-core/src/index.ts` and `@devdigest/shared` → `../server/src/vendor/shared/index.ts`), so both consumers resolve the exact same source files. `agent-runner/vitest.config.ts` re-declares the same two aliases (vitest/vite doesn't read `tsconfig.json` paths automatically) — matches the pattern already used in `reviewer-core/vitest.config.ts`. ref: agent-runner/tsconfig.json:21

## Tool & Library Notes

2026-07-08 — `@vercel/ncc` versions jump from `0.38.4` straight to `0.43.0`/`0.44.x` on npm (no `0.39`–`0.42` releases). A `^0.38.3` semver range resolves to `0.38.4`, not the newer `0.44.x` line — pin explicitly if the newer major-minor is desired. ref: agent-runner/package.json:15

## Tool & Library Notes

2026-08-15 — A first `pnpm install` in `agent-runner/` (e.g. right after `git checkout
course/lesson-7-lab/agent-runner -- agent-runner`) exits 1 with `[ERR_PNPM_IGNORED_BUILDS]:
esbuild@0.21.5` — pnpm's supply-chain build-script policy blocks the transitive `vitest` dep's
postinstall by default, even though `package.json`/the lockfile are untouched (the `+50` package
resolution itself still succeeds). `pnpm typecheck`/`pnpm test` need the postinstalled `esbuild`
binary to work. Fix: `pnpm approve-builds esbuild` (non-interactive form — no need for the
interactive `pnpm approve-builds` picker). This writes a package-local `agent-runner/pnpm-workspace.yaml`
(`allowBuilds: {esbuild: true}`) that should be committed with the rest of the package so future
clones don't re-hit the same gate. ref: agent-runner/pnpm-workspace.yaml

2026-08-16 — `agent-runner/.gitignore`'s own `dist/` line SHADOWS the root `.gitignore`'s
`!agent-runner/dist/` / `!agent-runner/dist/**` negation, even though the root file's own comment
says committing `dist/` is intentional. Git resolves conflicting `.gitignore` rules by directory
depth — a MORE NESTED `.gitignore` (here, `agent-runner/.gitignore`) wins over a less-nested one
(root) regardless of line order, so the root negation is silently overridden.
`git check-ignore -v agent-runner/dist/index.js` confirms the match is
`agent-runner/.gitignore:2:dist/`, not the root file. A plain `git add agent-runner/dist/index.js`
therefore no-ops with zero error/warning — it just never shows up in `git status`. Fix used: `git
add -f agent-runner/dist/index.js agent-runner/dist/300.index.js agent-runner/dist/package.json`
(force-add bypasses the ignore rule without editing any `.gitignore`). A more permanent fix would
be adding the same `!dist/` / `!dist/**` negation to `agent-runner/.gitignore` itself, but that
wasn't done here since it's outside this session's declared file list. ref: agent-runner/.gitignore:2

2026-08-16 — `pnpm build` (`ncc build src/index.ts -o dist`) now emits a SECOND, lazily-loaded
chunk file (`dist/300.index.js`, ~6KB) alongside `dist/index.js`, contradicting the 2026-07-08
finding above that ncc "fully inlines" everything into one self-contained file. Traced to the
bundled `openai` SDK's Node-only file-upload helper (`fileFromPath`) — ncc keeps it as a separate
chunk loaded via `__nccwpck_require__.e(/* import() */ 300)`, a pattern ncc can't statically inline
when the target module does its own conditional dynamic `import()`. Confirmed DEAD CODE for this
package: grepped `reviewer-core/src` and `agent-runner/src` for `fileFromPath`/`toFile`/
`files.create`/`.files.` — zero hits in either. Confirmed unreachable at runtime too: copied
`dist/index.js` alone into a directory with NO ancestor `package.json` anywhere (true simulation of
an arbitrary target repo, since the Export-to-CI bundle embeds this file standalone as
`.devdigest/runner/index.js`) and ran it directly with `node index.js` (Node v22.22) — it executed
correctly (failed only on the expected missing-manifest precondition), never touching the chunk.
Two follow-ups for whoever touches this next: (1) still COMMIT the whole `dist/` output
(`index.js` + `300.index.js` + `package.json`), not just `index.js`, in THIS repo — if a future
`reviewer-core`/SDK change ever makes that upload path reachable, the single-file embedding model
(`server/src/modules/ci/runner-bundle.ts` reads and ships exactly ONE file into target repos) would
silently break in someone else's CI with no way to also ship the sibling chunk; re-run this same
dead-code check after any `openai`/`reviewer-core` dependency bump. (2) Running the bundle with
zero ancestor `package.json` worked here despite `dist/index.js` containing top-level ESM `import`
syntax and no `agent-runner/package.json`'s `"type": "module"` being visible from that location —
this relies on Node's module-syntax auto-detection (default in Node ≥22, backported to some 20.x
patch releases), the same assumption `workflow.ts`'s "no setup-node, ubuntu-latest ships Node ≥20"
comment already accepts; not verified against every Node 20.x patch GitHub's `ubuntu-latest` image
might actually ship. ref: agent-runner/package.json:15 (ncc build script)

## Recurring Errors & Fixes

2026-07-08 — A hand-rolled unified-diff parser (`diff.ts`) that does `raw.split('\n')` without dropping a trailing empty element will over-count the last hunk's new-side line coverage by one. Any diff string terminated by `\n` (which `git diff` / GitHub's `Accept: application/vnd.github.v3.diff` output always is) produces a trailing `''` after `split('\n')`; if the parser's "else = context line" branch doesn't special-case it, that phantom line gets pushed onto `newLineNumbers`, silently widening what the citation-grounding gate considers "in the diff" by one line past the real hunk. Fix: `if (lines[lines.length - 1] === '') lines.pop()` right after the split, before the per-line loop. Caught by a fixture test asserting the exact `newLineNumbers` array, not just hunk counts. ref: agent-runner/src/diff.ts:19

2026-07-08 — `if (result.error) {...} else { result.artifact.findings_count }` does NOT narrow a discriminated union (`RunCiSuccess | RunCiFailure`) in TypeScript when the discriminant property (`error`) is typed `string` on the failure branch and `undefined` on the success branch (not a shared literal). `tsc` correctly refuses to narrow on truthiness here (a failure could theoretically carry `error: ''`). Discriminate on a property with a real type difference instead — `result.artifact === null` (`CiResultArtifact | null`) narrows cleanly both ways. ref: agent-runner/src/index.ts:52

## Session Notes

2026-07-08 — T7: scaffolded `agent-runner/` (`package.json`, `tsconfig.json`, `src/index.ts` placeholder importing `groundingSummary` from reviewer-core + `AgentManifest` from shared, `vitest.config.ts`). Hit the cross-package `node_modules` resolution gotcha (see What Doesn't Work) — resolved by installing `reviewer-core`'s own deps. `pnpm typecheck`, `pnpm build` (ncc, single bundle, zero external imports), and `pnpm test` (no test files, passWithNoTests) all pass. Files: agent-runner/package.json, agent-runner/tsconfig.json, agent-runner/src/index.ts, agent-runner/vitest.config.ts.

2026-07-08 — T8: implemented the real CI runner CLI, replacing T7's placeholder. Module layout: `manifest.ts` (locate + Zod-validate the single `.devdigest/agents/*.yaml`), `skills.ts` (read `.devdigest/skills/<slug>.md` bodies), `context.ts` (resolve owner/repo/PR number/title/body from `GITHUB_REPOSITORY`/`PR_NUMBER`/`GITHUB_EVENT_PATH`), `diff.ts` (self-authored unified-diff parser — can't import the server's, would break bundle self-containment), `github.ts` (hand-rolled `fetch`-based GitHub REST calls — `octokit` isn't a declared dependency and adding one wasn't in scope), `artifact.ts` (build + `CiResultArtifact.safeParse` the result JSON), `errors.ts` (`RunnerError`), `run.ts` (`runCi` — the single orchestrator, one top-level try/catch for Q5 hard-fail semantics), `index.ts` (CLI entry, wires real fs/fetch/`OpenRouterProvider` into `runCi`). `run.ts` calls reviewer-core's real `reviewPullRequest` (which internally does `assemblePrompt`/`wrapUntrusted`/`groundFindings`) — never hand-rolls any of that — then computes the GitHub event and exit code deterministically via `toReviewPayload`/`countBlockers`/`gateTriggered` against the manifest's `ci_fail_on`, ignoring the model's self-reported `verdict`. Gap found: `AgentManifest` (frozen shared contract) has no `post_as` field — only `CiExportInput` (server export-time input) does, and the already-generated GHA workflow doesn't pass a `POST_AS`-shaped env var either. Resolved by making `postAs` an explicit `runCi()` parameter (fully unit-testable) and resolving it at the CLI layer from an optional `DEVDIGEST_POST_AS` env var (default `'github_review'`) — flagged as a cross-track wiring gap for whoever finishes the end-to-end workflow → runner env contract. 19 hermetic tests (`manifest.test.ts`, `diff.test.ts`, `run.test.ts`) cover AC-20 through AC-26, AC-36 parity, and the Q5 hard-fail path; `pnpm typecheck`, `pnpm test`, and `pnpm build` all pass; `dist/index.js`'s 7 `@devdigest` occurrences are all inside comments, confirming zero runtime `@devdigest/*` imports survive bundling. Files: agent-runner/src/{errors,manifest,skills,diff,context,github,artifact,run,index}.ts, agent-runner/src/{manifest,diff,run}.test.ts.

## Open Questions

2026-07-08 — `AgentManifest` has no `post_as` field and the generated GHA workflow (`server/src/modules/ci/workflow.ts`) doesn't set a `POST_AS`-equivalent env var, so in production the runner will always fall back to `index.ts`'s default (`'github_review'`) regardless of what the studio's export dialog captured (`CiExportInput.post_as`). Should `post_as` be folded into `AgentManifest` (persisted per-agent, read by the runner) or threaded through the workflow as an explicit env var? Whoever owns the export/workflow-generation track should close this loop — `runCi()` already accepts `postAs` as a first-class parameter, so wiring either fix through only touches `index.ts` plus the manifest/workflow generator. ref: server/src/vendor/shared/contracts/eval-ci.ts (AgentManifest), agent-runner/src/index.ts:25
