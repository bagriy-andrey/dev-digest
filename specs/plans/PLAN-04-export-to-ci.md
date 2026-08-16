# Implementation Plan: Export to CI (SPEC-04)

**Status:** planning
**Scope:** server (`@devdigest/api`) · client (`@devdigest/web`) · shared contracts (one optional field, both vendored copies) · `agent-runner` (build + commit `dist/` only — **zero source edits**)
**Spec:** `specs/SPEC-04-export-to-ci.md` (source of truth for WHAT/WHY — do not re-litigate behavior here)
**Execution mode:** `multi-agent`, **capped at 5 implementer dispatches** (see §3). Waves: **W1** = Step 1 ∥ Step 2 → **W2** = Step 3 ∥ Step 4 → **W3** = Step 5.
**agent-runner:** **zero source edits.** This feature is a *producer* of the manifest/workflow it reads and a *consumer* of its `devdigest-result.json`. The only thing Step 2 does to that package is run `pnpm build` and commit the generated `dist/index.js` (which `.gitignore` explicitly un-ignores).

> This document is HOW to build an already-specced feature, file-by-file, in
> dependency order. Every step lists the exact files it owns; no two steps share
> a file. The Implementer executes one step at a time.

> **Guiding constraint carried from the spec (§Goals): simplest workable version, not the most
> complete one.** Every `[NEEDS CLARIFICATION]` was resolved with the cheapest option. This plan
> must not reintroduce what the spec deliberately avoided: **no** webhook receiver, **no** repo
> picker / import-status plumbing, **no** round-trip YAML→checkbox parser, **no** conditional
> `permissions:` generation, **no** speculative abstraction "for later". The success bar is a
> working, demoable end-to-end flow (wizard → PR → real CI run → ingest → CI Runs page), not a
> production-hardened one.

---

## 0. What already exists (do not touch / do not rebuild)

The spec's own "Existing building blocks" table is ground truth and was re-verified against the
current tree during planning. The table below records only what planning **added or corrected** on
top of it — read it before writing any code.

| Artifact | Location | State / how it's used here |
|---|---|---|
| `agent-runner` CLI (manifest loader, skills loader, diff, context, artifact, run) | `agent-runner/src/**` | **Frozen.** Consumed only as a contract: `.devdigest/agents/<slug>.yaml` (exactly one), `.devdigest/skills/<slug>.md` per manifest slug, `.devdigest/runner/index.js`, env `OPENROUTER_API_KEY`/`GITHUB_TOKEN`/`GITHUB_REPOSITORY`/`PR_NUMBER`/`DEVDIGEST_POST_AS`, output `devdigest-result.json`. |
| **`agent-runner/dist/index.js` does NOT exist in this checkout** | `ls agent-runner/dist` → *No such file* | **Planning finding.** The bundle must be built (`pnpm install && pnpm build` in `agent-runner/`) and **committed** — root `.gitignore` has an explicit `!agent-runner/dist/**` negation, so committing it is intended, not an accident. Step 2 owns this. Without it the export has no runner file to embed (AC-5). |
| `AgentManifest`, `CiFile`, `CiTarget`, `CiExportInput`, `CiInstallation`, `CiExport`, `CiRun`, `CiRunStatus`, `CiResultArtifact` | `server/src/vendor/shared/contracts/eval-ci.ts:280-389` | **Reused verbatim.** Exactly ONE additive change in this whole feature: `CiExportInput.files?` (see D3). |
| **The two vendored `eval-ci.ts` copies are ALREADY not identical** | client copy has **no** `AgentManifest` block and imports `knowledge.js` without `CiFailOn`; its `ConformanceInput.provider` union is narrower | **Planning finding — critical.** The mirroring rule is "the ONE new `files?` line must be identical in both copies", **not** "make the files identical". Do **not** `cp` the server file over the client one — that would drag `AgentManifest`/`CiFailOn` into the client build. |
| `ci_installations` / `ci_runs` tables | `server/src/db/schema/ci.ts` (migrated in `0000_init.sql`) | **Reused.** Step 1 adds two columns + two unique indexes, nothing else. |
| **`ci_installations` has NO unique constraint on (agent_id, repo, target_type)** | `schema/ci.ts:4-12` | **Planning finding.** AC-22's "update, don't duplicate" is unimplementable as an upsert without one. Step 1 adds it. |
| `agent_runs` (`source` enum `local`\|`ci`, default `local`; `workspace_id` NOT NULL; `pr_id` nullable) | `server/src/db/schema/runs.ts:8-34` | The AC-47 second write target. `workspace_id` comes from the installation's agent; `pr_id` stays null (AC-51). |
| `agents.ci_fail_on` (`never`\|`critical`\|`warning`\|`any`, default `critical`), already in agents CRUD + `PUT /agents/:id` | `schema/agents.ts:25-27`, `modules/agents/{routes,service}.ts` | **AC-38 needs ZERO new server code** — the CI tab binds the existing `useUpdateAgent` mutation. |
| `OctokitGitHubClient.commitFiles / findOpenPr / openPullRequest` | `adapters/github/octokit.ts:245-349` | **Reused as-is** via `await container.github()`. `commitFiles` layers on the parent tree and force-updates the ref (re-export safe); `findOpenPr` matches only OPEN PRs. |
| `GitHubClient` port has **no** Actions API surface | `vendor/shared/adapters.ts:143-167` | **Planning finding.** Ingest needs `GET /actions/workflows/<file>/runs`, `.../runs/:id/artifacts`, artifact ZIP download. Resolved by a **module-local port** (D2), not by editing the vendored port. |
| `MockGitHubClient` (records `committed[]`, `openedPrs[]`) | `adapters/mocks.ts:130+` | Reused for the export integration test. Step 3 adds a sibling `MockActionsClient` in the same file. |
| `getContext(container, req)` + `IdParams` | `modules/_shared/{context,schemas}.ts` | Workspace-scope EVERY new route. Non-negotiable (AC-24). |
| Per-route `config.rateLimit` pattern | `modules/reviews/routes.ts:29`, `modules/evals/routes.ts` | Copy onto `POST /agents/:id/export-ci` and `POST /ci-runs/refresh`. **Behaviourally unobservable under `NODE_ENV=test`** — assert by source read only (`server/insights.md`). |
| In-process "what's running" registry pattern | `modules/evals/batch-registry.ts` | The AC-53 ingest guard mirrors it exactly (module-scope `Set`, one API instance per DB — an assumption `server/AGENTS.md` already documents). |
| `adm-zip` (already a server dependency) | `server/package.json` | Artifact download returns a **ZIP**; unzip with the dep that's already there. No new unzip library. |
| **`yaml` is NOT a server dependency** | `server/package.json` | **Planning finding.** Manifest serialization needs it (D1). One-line add. |
| **No `.transaction(` call exists anywhere in `server/src`** | grep | **Planning finding.** AC-47's atomic pair write is the first use of `db.transaction(...)` in this repo. Drizzle/postgres-js supports it; call it out in review. |
| `ExportWizardSteps({ step, labels })` | `client/src/vendor/ui/ExportWizardSteps.tsx` | Reuse verbatim for the 4-step header (AC-25). Already exported from `@devdigest/ui`. |
| `Modal`, `Checkbox`, `TextInput`, `SelectInput`, `EmptyState`, `Badge`, `Button`, `SectionLabel`, `MonoLink`, `Chip`, `Skeleton` | `client/src/vendor/ui/{kit,primitives}` | Everything the wizard/tab/page need already exists. **Do not add a UI primitive; do not add an icon** — `icons.tsx` is a curated subset and is vendored (`client/insights.md`). |
| `activeKeyFor()` already returns `"ci-runs"` for `/ci-runs` | `client/src/components/app-shell/helpers.ts:38` | **Do NOT edit this function.** The missing half is the NAV entry (below). |
| **`vendor/ui/nav.ts` has no `ci-runs` item** | `client/src/vendor/ui/nav.ts` | The one-line addition MUST use `key: "ci-runs"` exactly. Three separate consumers read a NAV item's `.key`: `Sidebar.tsx` (highlight), `activeKeyFor` (already correct), and `useShellCommands.ts` → `t(\`nav.${it.key}\`)`. `messages/en/shell.json` already has `"ci-runs": "CI Runs"` — so all three line up **only** if the key string is exact. This near-miss has already shipped twice in this repo (`client/insights.md`). |
| `agents/[id]/page.tsx`'s `VALID_TABS` **already contains `"ci"`** | `client/src/app/agents/[id]/page.tsx:15` | **Do NOT edit `page.tsx`.** Only `AgentEditor/constants.ts` (`TABS`) + `AgentEditor.tsx` (render branch) need the `ci` entry. `messages/en/agents.json` already has `editor.tabs.ci: "CI"`. |
| **`client/messages/en/ci.json` already exists** with `runs`, `exportWizard`, `ciTab`, `publishDialog`, `page` blocks | `client/messages/en/ci.json` | **Planning finding — AC-35 is mostly additive to an existing catalogue.** Two corrections are required, not just additions: `exportWizard.blockMergeDesc` currently reads *"Requires a GitHub App — not available with PAT in local mode"*, which **directly contradicts AC-32/US-6** (branch protection + `ci_fail_on`, no App). The unused `publishDialog` block is from an older mock flow — leave it alone, do not build against it. |
| `lib/hooks/index.ts` is a hand-maintained barrel | `client/src/lib/hooks/index.ts` | A new `hooks/ci.ts` is unreachable via `@/lib/hooks` without an explicit `export * from "./ci";`. |
| `lib/types.ts` re-export hub is a **per-name allowlist** | `client/src/lib/types.ts` | No CI type is re-exported today. Step 1 adds them; steps that don't own this file must derive nested types structurally instead of widening their file list (`client/insights.md`). |

### Files this feature must NOT touch

`agent-runner/src/**` · `reviewer-core/**` · `server/src/db/migrations/*` by hand (generated only) ·
`client/src/vendor/ui/**` **except** the single `nav.ts` NAV entry · `client/src/app/agents/[id]/page.tsx` ·
`client/src/components/app-shell/helpers.ts` (`activeKeyFor` is already correct) ·
`client/messages/en/{shell,agents}.json` (the two keys this feature needs already exist) ·
`eval-ci.ts`'s Eval / Conformance / Compose / Hook blocks · `messages/en/ci.json`'s `publishDialog` block.

---

## Plan-level decisions (things the spec left to the build)

These are **HOW** decisions. None changes an acceptance criterion. Recorded so the Implementer does
not re-derive them.

**D1 — Manifest YAML is produced by the `yaml` package, never by hand.** A hand-rolled serializer
must correctly emit a multi-line, user-authored `system_prompt` (block scalar, indentation, quoting)
— a bug there is a *YAML-injection* vector into someone else's repo and breaks AC-7's round trip.
Add `yaml@^2.6.1` to `server/package.json` (same version `agent-runner` already uses to *parse* it)
and generate with `stringify(AgentManifest.parse({...}))`. Parse-back in tests uses the same
`yaml.parse` + `AgentManifest.safeParse` pair `agent-runner/src/manifest.ts:76` uses, which is what
makes the AC-7 round-trip assertion equivalent to `loadAgentManifest` without importing across
packages (the server has no path alias to `agent-runner`).

**D2 — the Actions API goes behind a MODULE-LOCAL port, not an extension of `GitHubClient`.**
`GitHubClient` lives in vendored `shared/adapters.ts`, which also feeds `reviewer-core` **and**
`agent-runner`; widening it would ripple into the shipped CI bundle for two read-only methods used
by exactly one module. `onion-architecture`'s ports rule explicitly sanctions module-local ports
(`modules/<name>/types.ts`). So: `modules/ci/types.ts` declares
`ActionsClient { listWorkflowRuns(repo, workflowFile, limit); listRunArtifacts(repo, runId); downloadArtifactJson(repo, artifactId) }`;
`adapters/github/actions.ts` implements it with octokit + `adm-zip`; the container exposes
`githubActions()` with a `ContainerOverrides.githubActions` hook so tests inject a mock.

**D3 — AC-29 (commit the EDITED file contents) requires one additive contract field.**
`CiExportInput` carries no `files`, so an edited workflow YAML has no way to reach the server, and
the client cannot commit on its own. Minimal resolution: add `files: z.array(CiFile).optional()` to
`CiExportInput` in **both** vendored copies (identical line). Server rules, non-negotiable
(security — DevDigest writes executable code into someone else's repo):
1. Generate the bundle first, always.
2. An override entry is applied **only** if its `path` matches a generated path **exactly** and
   that generated file is `editable: true`. Every other override entry is **dropped silently**
   (never appended as a new file, never allowed to touch `.devdigest/runner/index.js`).
3. The manifest file, if overridden, is re-validated through `AgentManifest` before commit; a
   failing override is dropped in favour of the generated one (AC-1/AC-7 parity survives editing).

**D4 — `action: 'files'` returns a TRANSIENT installation and persists nothing.** `CiExport`
requires a non-nullable `installation`, but a Preview is not an install — persisting one would put
never-installed repos on the CI tab and would poison AC-26a's "does this repo already run another
agent?" lookup. So: `files` → return the **existing** installation row if one exists, otherwise a
synthesized `{ id: '', agent_id, repo, target_type, installed_at: <now> }`, with a code comment
saying so. Only `open_pr` upserts (AC-22). The client must never use `installation.id` from a
preview response.

**D5 — the two display fields the CI Runs page needs that `CiRun` lacks are added at the route
boundary, not in the vendored contract.** `CiRun` has `agent`/`duration_s` (nullish, derived per
AC-40 via the `agent_run_id` join) but **no `repo`**. Rather than mutate a frozen contract, the
route declares its response as `CiRun.extend({ repo: z.string().nullable() })` locally in
`modules/ci/routes.ts`, and the client declares the matching transport type in `lib/hooks/ci.ts`.
This is the same "contract + transport-only extra fields" pattern `BlastRadiusResult` already uses
(`client/src/lib/types.ts`). Same for the installations list:
`CiInstallation.extend({ agent_name, latest_run: CiRun.nullable() })`.

**D6 — status derivation (AC-49) is artifact-first, conclusion-second.**
`run.status !== 'completed'` → `running`. `conclusion ∈ {skipped, cancelled}` → **not persisted at
all** (a skipped fork job is not a review, and recording it as `failed` would make every fork PR
look like an infra failure). Otherwise: valid artifact → `findings_count > 0 ? 'succeeded' :
'no_findings'` (a **gate-blocked** run has an artifact and exits 1 — it is a *successful review*,
not a failure); missing/invalid artifact → `failed` (the hard-fail path, `agent-runner/src/run.ts:167-172`).
The conclusion is logged either way.

**D7 — rate-limit thrift is a skip-list, not an ETag cache.** Each pass lists at most
`MAX_RUNS_PER_PASS = 20` workflow runs and **skips fetching artifacts for any `workflow_run_id`
already stored with a terminal status** (only `running` rows are re-fetched). That's ~1 request per
pass in the steady state versus 3+ per run, with no conditional-request machinery. Conditional
requests / ETags are explicitly out of scope for this iteration.

**D8 — "Verify: e2e" acceptance criteria are satisfied by RTL component tests + the manual
checklist**, not by new `e2e/` flows. The `e2e` package is a separate deterministic
agent-browser suite and adding flows there is a whole extra dispatch this feature's 5-step budget
doesn't have. Every AC marked *Verify: e2e* in the spec appears in §3 against an RTL test and/or in
§4's manual verification list. This is a deliberate, recorded scope call.

**D9 — `triggers` is untrusted input and MUST be allowlist-filtered before it reaches the YAML.**
`CiExportInput.triggers` is `z.array(z.string())` — arbitrary strings interpolated into a workflow
file in someone else's repository. The generator filters against `{opened, synchronize, reopened}`
preserving that canonical order, and falls back to `['opened','synchronize']` if the filtered set is
empty. Same discipline for `repo` (regex `^[\w.-]+/[\w.-]+$` → `RepoRef`) and `base` (a git ref
charset check). `post_as` is already an enum.

**D10 — `.devdigest/memory.jsonl` is a workspace-scoped, capped, embedding-free dump.** One JSON
object per line: `{scope, kind, content, confidence, created_at}` from the `memory` table for the
export's workspace, newest first, capped at `MAX_MEMORY_ENTRIES = 500`. **Never** serialize the
`embedding` vector or `sources`. Zero rows → an empty file, not a missing one (AC-4). The table
being empty is expected, not a bug (root `AGENTS.md`).

---

## 1. Module breakdown (dependency order: shared → server → client)

### 1A. Shared contract (VENDORED — one identical line in BOTH copies)

**Modify** `contracts/eval-ci.ts` — **BOTH** `server/src/vendor/shared/contracts/eval-ci.ts` and
`client/src/vendor/shared/contracts/eval-ci.ts`:

- In `CiExportInput`, add exactly one field (D3):
  ```
  /** Optional Preview-edited file contents (AC-29). Server applies an override
   *  ONLY for a path it generated itself and only when that file is editable. */
  files: z.array(CiFile).optional(),
  ```
- Nothing else changes in either copy. **Do not reconcile the copies' pre-existing differences**
  (the client copy legitimately has no `AgentManifest` — see §0).

### 1B. Server — DB schema + migration

**Modify** `server/src/db/schema/ci.ts`

- `ciRuns`: add
  - `agentRunId: uuid('agent_run_id').references(() => agentRuns.id, { onDelete: 'set null' })` — nullable FK (AC-47). Import `agentRuns` from `./runs`.
  - `workflowRunId: text('workflow_run_id')` — GitHub's own run id, stored as text (avoids any int-precision question and is only ever used as a lookup key).
  - table extras: `uniqueIndex('ci_runs_installation_workflow_run_uq').on(t.ciInstallationId, t.workflowRunId)` (AC-48).
- `ciInstallations`: add `uniqueIndex('ci_installations_agent_repo_target_uq').on(t.agentId, t.repo, t.targetType)` (AC-22 — see §0, it does not exist today).
- Then: **isolation check first** (`server/insights.md`'s `0011`/`0012`/`cost_usd` incident) —
  temporarily move `schema/ci.ts` aside, run `pnpm db:generate` once to see what the generator
  proposes on its own, restore, generate again. If it proposes anything beyond these two columns +
  two indexes, **stop and report**; do not generate a catch-up migration.
- `pnpm db:generate` → `pnpm db:migrate`. Never hand-edit `src/db/migrations/*`.

### 1C. Server — `modules/ci/` (new module)

Standard shape: `constants → helpers/workflow (pure domain) → repository (infrastructure) →
services (application) → routes (adapter)`, registered with one import + one entry in
`modules/index.ts`. Onion check the Implementer must satisfy: `helpers.ts`/`workflow.ts` import
**nothing** from `drizzle-orm`, `db/`, `fastify`, or `adapters/`; `*-service.ts` never imports
`drizzle-orm`/`db/schema`/`fastify`; `routes.ts` never calls `db.*`.

**New** `modules/ci/constants.ts`
- `DEVDIGEST_DIR = '.devdigest'`, `MANIFEST_DIR = '.devdigest/agents'`, `SKILLS_DIR = '.devdigest/skills'`,
  `MEMORY_PATH = '.devdigest/memory.jsonl'`, `RUNNER_PATH = '.devdigest/runner/index.js'`,
  `WORKFLOW_FILE = 'devdigest-review.yml'`, `WORKFLOW_PATH = '.github/workflows/devdigest-review.yml'`.
- `CI_BRANCH = 'devdigest/ci'`, `PR_TITLE = 'Add DevDigest CI review'`, `COMMIT_MESSAGE`.
- `WORKFLOW_JOB_ID = 'devdigest-review'`, `WORKFLOW_JOB_NAME = 'DevDigest Review'` — **constants, never derived from the agent/slug** (AC-13: a branch-protection required check is matched by job name).
- `ALLOWED_TRIGGERS = ['opened','synchronize','reopened'] as const`, `DEFAULT_TRIGGERS = ['opened','synchronize']` (D9).
- `ARTIFACT_NAME = 'devdigest-result'`, `ARTIFACT_FILE = 'devdigest-result.json'`.
- `MAX_RUNS_PER_PASS = 20`, `MAX_MEMORY_ENTRIES = 500`.

**New** `modules/ci/helpers.ts` — pure, unit-testable, zero I/O
- `slugify(name): string` — lowercase, `[^a-z0-9]+` → `-`, collapse/trim, fallback `'skill'`.
- `slugifyUnique(names: string[]): string[]` — deterministic disambiguation by first-occurrence order (`security-rules`, `security-rules-2`, …) so `Security Rules` and `security rules` never collapse (AC-3, edge case 2).
- `parseRepoRef(repo: string): { owner: string; name: string }` — regex-validated, throws `ValidationError` otherwise (D9).
- `sanitizeTriggers(triggers: string[]): string[]` (D9).
- `buildManifest(agent, skillSlugs): AgentManifest` — `{name, provider, model, system_prompt, skills, strategy, ci_fail_on}` straight from the agent row; **no CI-only transformation of any field** (AC-7, AC-54).
- `manifestYaml(manifest): string` — `stringify(AgentManifest.parse(manifest))` (D1).
- `memoryJsonl(rows): string` (D10) — empty input ⇒ `''`.
- `buildBundle({ manifest, manifestSlug, skills, memoryRows, runnerBundle, workflowYaml }): CiFile[]` — assembles, in a stable order: `.devdigest/agents/<slug>.yaml`, one `.devdigest/skills/<slug>.md` per manifest slug (AC-3), `.devdigest/memory.jsonl` (AC-4), `.devdigest/runner/index.js` **`editable: false`** (AC-5/AC-28), `.github/workflows/devdigest-review.yml`. Exactly ONE manifest file, always (AC-2).
- `applyFileOverrides(generated: CiFile[], overrides?: CiFile[]): CiFile[]` — D3's allowlist rule, pure and directly unit-testable.

**New** `modules/ci/workflow.ts` — pure; one exported function, one string
- `renderWorkflow({ triggers, postAs }): string` producing exactly:
  ```yaml
  name: DevDigest Review

  on:
    pull_request:
      types: [opened, synchronize]          # ← sanitizeTriggers output, canonical order (AC-9)

  # Declaring any permissions key sets every unlisted scope to none — this block
  # IS the deny-by-default boundary (AC-10). Fixed, never branched on post_as.
  permissions:
    contents: read
    pull-requests: write
    issues: write

  jobs:
    devdigest-review:                        # stable job id (AC-13)
      name: DevDigest Review                 # stable job NAME — branch protection matches on this
      # Fork PRs receive no repository secrets; run the job at all and it would
      # hard-fail on an empty OPENROUTER_API_KEY and look like a blocking verdict.
      # Skip explicitly so it is observable AS a skip (AC-12).
      if: github.event.pull_request.head.repo.fork == false
      runs-on: ubuntu-latest
      steps:
        - uses: actions/checkout@v4
        - name: Run DevDigest review
          env:
            OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}
            GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
            GITHUB_REPOSITORY: ${{ github.repository }}
            PR_NUMBER: ${{ github.event.pull_request.number }}
            DEVDIGEST_POST_AS: github_review     # ← the wizard's post_as (AC-14)
          run: node .devdigest/runner/index.js
        - name: Upload DevDigest result
          if: always()                        # gate-blocked runs exit 1 and MUST still upload (AC-15)
          uses: actions/upload-artifact@v4
          with:
            name: devdigest-result
            path: devdigest-result.json
            if-no-files-found: warn
  ```
  Notes the Implementer must honour: trigger is `pull_request`, **never** `pull_request_target`
  (AC-11); no `issue_comment` trigger (spec §Untrusted inputs item 2); **no `uses:` for the review
  itself** — the runner travels in the same PR (AC-8/AC-17); **no `setup-node` step** (the
  `ubuntu-latest` image ships Node ≥20 and the bundle is dependency-free — one fewer third-party
  action on the audit surface); no `echo`/`env`-dump of any secret (AC-16).

**New** `modules/ci/runner-bundle.ts` — the module's one filesystem read
- `readRunnerBundle(config): string` — reads the path from `AppConfig.runnerBundlePath`; on ENOENT
  throws a `ConfigError` naming the fix verbatim (`cd agent-runner && pnpm install && pnpm build`).
  Exported as a plain function so the service takes it as an injectable default parameter and
  hermetic tests pass a stub.

**New** `modules/ci/types.ts` — module-local ports + row types (D2)
- `ActionsClient` (see D2), `WorkflowRunSummary { id, html_url, status, conclusion, head_branch, run_started_at, pull_requests?: {number}[] }`, `ArtifactSummary { id, name, expired }`.
- `CiInstallationRow`, `CiRunRow` mapper types.

**New** `modules/ci/repository.ts` — Drizzle only, zero business logic
- `upsertInstallation(agentId, repo, targetType)` → `onConflictDoUpdate` on the new unique index (AC-22).
- `listInstallations(workspaceId, agentId?)` → join `ci_installations → agents` (workspace scope), left-join the latest `ci_runs` per installation (newest `ran_at`), plus `agents.name` (D5).
- `findInstallation(workspaceId, agentId, repo, targetType)`.
- `listRuns(workspaceId, limit)` → `ci_runs → ci_installations → agents`, left-join `agent_runs` on `ci_runs.agent_run_id` for `duration_ms` (AC-40) and the repo string (D5).
- `existingRunKeys(installationId)` → `Map<workflowRunId, status>` for D7's skip-list.
- `upsertRunWithAgentRun(input)` — **the AC-47/AC-48 write, inside one `db.transaction`**: upsert
  `agent_runs` (`source:'ci'`, `workspace_id` from the installation's agent, `provider`/`model`
  copied from that agent's current config, `tokens_in`/`tokens_out` **null**, `pr_id` null),
  then upsert `ci_runs` on `(ci_installation_id, workflow_run_id)` carrying `agent_run_id`. Never
  one without the other, in either direction. Re-ingest updates both rows (AC-48).
- `listMemory(workspaceId, limit)` — content-only projection, never `embedding` (D10).

**New** `modules/ci/export-service.ts` — `CiExportService(container)`
- `export(workspaceId, agentId, input: CiExportInput, logger?)`:
  1. `container.agentsRepo.getById(workspaceId, agentId)` → `NotFoundError` if absent (**AC-24**: an agent outside the workspace is simply not found).
  2. Reject a non-`gha` target with a `ValidationError` naming the target (AC-26's server half — no fake install).
  3. `parseRepoRef(input.repo)`; `linkedSkills(agentId)` filtered `link.enabled && link.skill.enabled` (the two-flag rule from `server/insights.md`), ordered.
  4. `slugifyUnique(skill names)` → manifest `skills[]` + one file per slug; `buildManifest`; `manifestYaml`; `memoryJsonl(repo.listMemory(...))`; `readRunnerBundle`; `renderWorkflow({triggers: sanitizeTriggers(input.triggers), postAs: input.post_as})`.
  5. `applyFileOverrides(generated, input.files)` (D3).
  6. `action === 'files'` → return `{ installation: <transient or existing> (D4), files, pr_url: null }`; **zero GitHub calls** (AC-21).
  7. `action === 'open_pr'` → `github.commitFiles(ref, { branch: CI_BRANCH, base: input.base, files, message })` → `findOpenPr(ref, CI_BRANCH)` → if none, `openPullRequest(ref, { title: PR_TITLE, head: CI_BRANCH, base: input.base, body })` (AC-19/AC-20). Only **after** the GitHub write succeeds: `upsertInstallation` (AC-22/AC-23).
  8. Error mapping (AC-23): wrap GitHub failures in `ExternalServiceError` preserving the API's own message; when it matches `/workflow|Workflows: write|refusing to allow a (Personal Access Token|GitHub App)/i`, prefix an explicit sentence naming the missing **`workflow` scope (classic PAT) / *Workflows: write* (fine-grained)**, distinct from contents write. Never report a partial install.
  9. Log `{ agentId, repo, target, action, branch, prUrl, fileCount }` — **never** the token, never a file body (spec §Observability, AC-6).

**New** `modules/ci/ingest-service.ts` — `CiIngestService(container)`
- `refresh(workspaceId, logger?)`: for each `gha` installation of the workspace:
  1. `ingestRegistry.tryAcquire(repo)`; if held → record `skipped` and continue (AC-53).
  2. `actions.listWorkflowRuns(ref, WORKFLOW_FILE, MAX_RUNS_PER_PASS)`.
  3. Per run: apply D7's skip-list; D6's status rules; `pr_number` from `run.pull_requests?.[0]?.number ?? artifact.pr_number ?? null` (fork runs report an empty `pull_requests[]` — AC-51); `github_url` **always** from `run.html_url`, never from the artifact (AC-50).
  4. Artifact: `listRunArtifacts` → the `devdigest-result` entry → `downloadArtifactJson` → `CiResultArtifact.safeParse` **before any field is persisted or returned** (AC-46). Invalid/expired/absent → count it, persist the run without payload, keep going.
  5. `repo.upsertRunWithAgentRun(...)` (AC-47/AC-48).
  6. Wrap each installation in try/catch: on API error/rate limit, record `{repo, reason}` and **leave existing rows untouched** (AC-52) — nothing in this path deletes or zeroes anything.
  7. Return + log `{ installationsChecked, runsExamined, artifactsValid, artifactsInvalid, artifactsMissing, skipped, failures[] }` so "why isn't my run in CI Runs?" is answerable from logs alone (spec §Observability).
- The artifact's `agent` string is **data**: persisted/rendered as text, never interpolated into a path, prompt, or command (spec §Untrusted inputs item 3).

**New** `modules/ci/ingest-registry.ts` — module-scope `Set<string>` keyed by `repo`, `tryAcquire`/`release`, mirroring `evals/batch-registry.ts` (AC-53).

**New** `modules/ci/routes.ts` — default Fastify plugin, Zod via `fastify-type-provider-zod`, every handler `getContext`-scoped
| Route | Schema | ACs |
|---|---|---|
| `POST /agents/:id/export-ci` ⚡ | `params: IdParams`, `body: CiExportInput`, `200: CiExport` | AC-18…AC-24 |
| `GET /ci-installations` | `query: { agent_id?: uuid }`, `200: z.array(CiInstallationRow)` (D5) | AC-26a, AC-36, AC-37 |
| `GET /ci-runs` | `200: z.array(CiRunRow)` (D5) | AC-40, AC-41 |
| `POST /ci-runs/refresh` ⚡ | `200: CiRefreshSummary` (local schema) | AC-43, AC-45…AC-53 |

⚡ = `config: { rateLimit: { max: 10, timeWindow: '1 minute' } }` (assert by source read only).

**Modify** `server/src/modules/index.ts` — one import + one `ci,` entry.

**Modify** `server/src/platform/container.ts`
- `ContainerOverrides.githubActions?: ActionsClient`; a `githubActions(): Promise<ActionsClient>` getter mirroring `github()` (secret via `SecretsProvider.get('GITHUB_TOKEN')`, `ConfigError` when absent, cached, cleared in `invalidateSecretCaches`).

**Modify** `server/src/platform/config.ts`
- `DEVDIGEST_RUNNER_BUNDLE` env (optional) → `runnerBundlePath: string`, default
  `resolve(process.cwd(), '../agent-runner/dist/index.js')` (the server always runs with `server/`
  as cwd — `pnpm dev`, `pnpm test`, `scripts/dev.sh`). Not a secret; belongs in `AppConfig`.

**New** `server/src/adapters/github/actions.ts` — `OctokitActionsClient implements ActionsClient`
- `listWorkflowRuns` → `rest.actions.listWorkflowRuns({ workflow_id: 'devdigest-review.yml', per_page })`.
- `listRunArtifacts` → `rest.actions.listWorkflowRunArtifacts`.
- `downloadArtifactJson` → `rest.actions.downloadArtifact({ archive_format: 'zip' })` (octokit follows the 302 to the one-minute signed URL) → `new AdmZip(Buffer.from(res.data))` → read `devdigest-result.json` → `JSON.parse` inside try/catch returning `null` on any failure (never throw a parse error up as an infra failure).
- Mirror `octokit.ts`'s existing `withRetry`/`withTimeout` wrappers.

**Modify** `server/src/adapters/mocks.ts` — add `MockActionsClient implements ActionsClient` (fixture-driven runs/artifacts, including an "expired artifact" and a "malformed JSON" fixture) alongside the existing mocks.

### 1D. Client

**Modify** `client/src/lib/types.ts` — add to the re-export allowlist:
`CiTarget, CiFile, CiExportInput, CiInstallation, CiExport, CiRun, CiRunStatus`. **Type-only**, like
every other line there (no runtime import from `@devdigest/shared` is needed anywhere in this
feature — keep it that way; see the webpack `extensionAlias` entry in `client/insights.md`).

**Modify** `client/src/vendor/ui/nav.ts` — one item in the `SKILLS LAB` group:
`{ key: "ci-runs", label: "CI Runs", icon: "GitBranch", href: "/ci-runs" }`. The `key` string must
be **exactly** `"ci-runs"` (AC-44 — three consumers read it, see §0). Pick the icon from the
existing `icons.tsx` registry; **do not add an icon**.

**New** `client/src/lib/hooks/ci.ts` — TanStack Query, all through `lib/api.ts`
- Transport types (D5): `export type CiRunRow = CiRun & { repo: string | null }`, `export type CiInstallationRow = CiInstallation & { agent_name: string | null; latest_run: CiRun | null }`.
- `useCiInstallations(agentId?: string)` → `GET /ci-installations[?agent_id=]`, key `["ci-installations", agentId ?? "all"]`.
- `useCiRuns()` → `GET /ci-runs`, key `["ci-runs"]`.
- `useRefreshCiRuns()` → `POST /ci-runs/refresh`; `onSuccess` invalidates `["ci-runs"]` **and** `["ci-installations"]` (the CI tab shows the same latest-run data).
- `useExportCi()` → `POST /agents/:id/export-ci`; a single mutation serves both Preview (`action:'files'`) and Install (`action:'open_pr'`); `onSuccess` of an `open_pr` invalidates `["ci-installations"]`.

**Modify** `client/src/lib/hooks/index.ts` — `export * from "./ci";` (barrel is not auto-populated).

**Modify** `client/messages/en/ci.json` — the **single** i18n file this feature edits, so it must
carry every key steps 4 and 5 need (see §3's ownership note):
- **Correct** `exportWizard.blockMergeDesc` to AC-32's actual truth (Fail-CI-on + a required status check in the repo's own branch protection; no GitHub App).
- Add to `exportWizard`: `notAvailableYet` (AC-26), `replaceWarning`/`replaceConfirm` (AC-26a), `runnerNotPreviewable` (AC-28), `secretsTable.*` incl. `githubTokenAuto` / `openrouterManual` (AC-31), `triggers.*` (AC-30), `blockMergeBody` (AC-32), `copyZip`/`zipDownloaded`/`docsLink` (AC-33), `installedPr`/`viewPr` (AC-34), `repoInvalid`.
- Add to `ciTab`: `heading` ("CI deployment"), `installedIn` ({count} repositories), `addToCi`, `updateConfig`, `emptyBody`, `failCiOn` + its four option labels, `staleNotice` (AC-39), `latestRun`, `never`.
- Add to `runs`: `unknown` (the AC-41 marker), `emptyHow` (AC-42), `agent`, `repo`, `duration`, `viewJob`.
- **Do not touch** the `publishDialog` block.

**New** `client/src/components/ci/ExportWizard/**` (shared component dir, mirroring `components/eval/**`)
- `ExportWizard.tsx` — modal (`Modal` from `@devdigest/ui`) owning ALL wizard state in one place so
  Back/forward preserves every choice (AC-25); header is `ExportWizardSteps` with the four labels.
- `_components/TargetStep.tsx` — four target cards (GHA *recommended*, CircleCI, Jenkins, Generic
  CLI) each with a one-line description; a non-GHA selection shows `notAvailableYet` and **disables
  Continue/Install** (AC-26). Repo input is a plain free-text `owner/name` `TextInput` with hint +
  inline validation — **no picker, no repo list fetch** (AC-25, resolved clarification 9).
  AC-26a: when `useCiInstallations()` (unfiltered) has a row for this repo belonging to a *different*
  agent, render the named warning + an explicit confirm `Checkbox` that gates leaving the step; the
  same agent re-exporting is a normal update and must NOT warn.
- `_components/PreviewStep.tsx` — file list (workflow selected by default) + a code view;
  `editable: false` files render a short "not previewable" placeholder and **never** their contents
  (AC-27/AC-28 — the runner bundle is hundreds of KB of minified JS). Editing an editable file
  writes into the wizard's `edits: Record<path, string>` map (AC-29).
- `_components/ConfigureStep.tsx` — trigger checkboxes (`opened`+`synchronize` checked,
  `reopened` optional), "Post results as" (GitHub review *recommended* / PR comment / None — exit
  code only), the static secrets table (`OPENROUTER_API_KEY` = "you must add this yourself";
  `GITHUB_TOKEN` = "provided automatically by Actions"), and the merge-blocking callout
  (AC-30/AC-31/AC-32). Checkboxes drive the generated `on:` block **one-way**; nothing parses a
  hand-edited workflow back into checkbox state (resolved clarification 8).
- `_components/InstallStep.tsx` — "Open a PR with these files" (recommended; names the repo, the PR
  title, the file count) + "Copy files as a zip" + a docs link (AC-33); on success surfaces the PR
  URL as the next action (AC-34).
- `helpers.ts` — `isValidRepo`, `filesToZip(files)` (client-side only, includes the runner bundle,
  **no new server endpoint** — resolved clarification 7), `stepIndex` guards.
- `constants.ts` (targets, triggers, post-as options, secrets rows), `styles.ts`, `index.ts`, tests.
- Every string via `useTranslations("ci")`; no status conveyed by colour alone (AC-35).
- **Dependency:** add `jszip` to `client/package.json` for `filesToZip`. Hand-rolling a
  store-mode ZIP writer (CRC32 + local/central directory records) is the only alternative and is
  strictly more code and more risk for the same result.

**New** `client/src/app/agents/[id]/_components/AgentEditor/_components/CiTab/**` (sibling of `EvalsTab`/`ContextTab`, same folder convention)
- "CI deployment" header, a status pill reading how many repositories the agent is installed in,
  **Update CI config** + primary **+ Add to CI** (both open `ExportWizard`) (AC-36).
- One row per installation: repository, target-type badge, latest run status (icon/text, not colour
  alone) and its relative time; empty state = the **+ Add to CI** CTA, never an error (AC-37).
- **Fail CI on** selector bound to `agent.ci_fail_on` through the existing `useUpdateAgent`
  (AC-38), with the `staleNotice` copy stating installed repos keep running the previously exported
  manifest until the export is re-run (AC-39).

**Modify** `client/src/app/agents/[id]/_components/AgentEditor/constants.ts` — append
`{ key: "ci", labelKey: "editor.tabs.ci", icon: "GitBranch" }` to `TABS` (the message key already exists).
**Modify** `.../AgentEditor/AgentEditor.tsx` — one render branch `{tab === "ci" && <CiTab agent={agent} />}`.
(`page.tsx`'s `VALID_TABS` already allows `"ci"` — **do not edit it**.)

**New** `client/src/app/ci-runs/page.tsx` + `client/src/app/ci-runs/_components/CiRunsPage/**`
- Thin route entry delegating to a colocated `CiRunsPage` (mirrors `/eval`).
- Table: PR, repository, agent, verdict/status, findings count, cost, duration, link to the Actions
  job (AC-40). A genuinely unknown cost/duration renders the explicit `unknown` marker, never `0`
  (AC-41). Empty state explains how runs arrive: export → merge → open a PR (AC-42). A Refresh
  button calls `useRefreshCiRuns()` and shows in-progress state while it runs (AC-43); it may also
  fire once on mount (resolved clarification 4 — user-triggered + on load, **no poller, no webhook**).

---

## 2. Dependency changes

- **New packages: two, both minimal.**
  - `server`: `yaml@^2.6.1` (D1 — same version `agent-runner` parses with).
  - `client`: `jszip` (AC-33's client-side zip). No other new dependency anywhere.
- **DB migration: one**, generated, covering two `ci_runs` columns + two unique indexes (§1B).
  Isolation check first; `pnpm db:generate` → `pnpm db:migrate`; never hand-edit
  `src/db/migrations/*` (including `meta/_journal.json`).
- **Vendored `@devdigest/shared`:** exactly one line (`CiExportInput.files?`) in **both** copies
  (D3). Step 1 owns both files, so they can never land apart. Do **not** sync anything else — the
  copies are legitimately divergent (§0).
- **Built artifact:** `agent-runner/dist/index.js` must be built and **committed** (Step 2).
  `agent-runner` is not in any workspace: `cd agent-runner && pnpm install` (if it exits 1 with
  `ERR_PNPM_IGNORED_BUILDS: esbuild`, run `pnpm approve-builds esbuild` — the resulting
  `agent-runner/pnpm-workspace.yaml` is already committed) then `pnpm build`.
- **Env vars:** one optional, non-secret — `DEVDIGEST_RUNNER_BUNDLE` (path override for the bundle).
  No new secret is introduced anywhere: the export path reads `GITHUB_TOKEN` only through the
  existing `SecretsProvider`/container, and **no secret value may reach a generated file, the
  `CiExport` response, or a log line** (AC-6).
- **`reviewer-core/node_modules` must be installed** in the checkout/worktree or
  `cd server && pnpm typecheck` fails resolving `openai`/`zod` inside reviewer-core source:
  `cd reviewer-core && npm install` once (reviewer-core uses **npm**, not pnpm).
- **Seed:** unchanged.

---

## 3. Execution order

**Deliberate constraint: this feature is built in AT MOST 5 implementer dispatches.** The grouping
below is chosen for that budget — each step is a coherent, independently testable unit, not a
mechanical per-file split. Do not sub-divide a step into extra dispatches; do not merge two steps
(their file lists are what keeps parallel work collision-free).

**File lists are disjoint across every step.** Under `multi-agent`, steps within a wave may be
dispatched in parallel; under `single-agent`, work S1→S5 in order.

---

### Wave 1 — Steps 1 and 2 (parallel, no dependency between them)

#### Step 1 — Data layer + cross-package foundation
**Depends on:** nothing.
**Owns:**
- `server/src/vendor/shared/contracts/eval-ci.ts`
- `client/src/vendor/shared/contracts/eval-ci.ts`
- `server/src/db/schema/ci.ts`
- `server/src/db/migrations/**` (generated only)
- `server/src/platform/config.ts`
- `server/package.json` (add `yaml`)
- `server/src/modules/ci/types.ts`
- `server/src/modules/ci/repository.ts`
- `server/test/ci-repository.it.test.ts` (new, real Postgres — the `.it.test.ts` suffix is mandatory)
- `client/src/lib/types.ts`
- `client/src/vendor/ui/nav.ts`
- `client/src/components/app-shell/helpers.test.ts`

**Test criteria:**
- `cd server && pnpm typecheck` and `cd client && pnpm typecheck` clean. `pnpm db:generate` proposes
  **exactly** the two `ci_runs` columns + the two unique indexes and nothing else (isolation check
  per §1B); a proposal touching anything else ⇒ **stop and report**.
- The `files?:` line is identical in both vendored copies; no other diff in either file.
- `.it.test.ts`: upsert the same `(agent, repo, target)` twice ⇒ **one** `ci_installations` row
  (**AC-22**); `upsertRunWithAgentRun` writes both rows in one transaction with `ci_runs.agent_run_id`
  set, `agent_runs.source='ci'`, `workspace_id` from the installation's agent, `provider`/`model`
  copied from the agent, `tokens_in`/`tokens_out` null (**AC-47**); re-ingesting the same
  `workflow_run_id` **updates** both rows instead of inserting (**AC-48**); `listRuns` returns the
  agent name and `duration_ms` via the FK join, and `repo` from the installation (**AC-40**);
  a run whose PR was never imported still persists with `pr_id`/`pr_number` null (**AC-51**).
- `helpers.test.ts`: `activeKeyFor("/ci-runs")` returns the exact string the new NAV item's `key`
  carries (**AC-44**).
> ⚠️ `.it.test.ts` files cannot execute in this sandbox (testcontainers can't reach a working
> container runtime — `server/insights.md`). Write and typecheck them, verify by close reading, and
> **say so in the summary** rather than debugging the runtime error.

#### Step 2 — Bundle + workflow generation (pure) + the runner artifact
**Depends on:** nothing (imports only frozen contracts).
**Owns:**
- `server/src/modules/ci/constants.ts`
- `server/src/modules/ci/helpers.ts`
- `server/src/modules/ci/workflow.ts`
- `server/src/modules/ci/runner-bundle.ts`
- `server/test/ci-bundle.test.ts` (new, hermetic)
- `server/test/ci-workflow.test.ts` (new, hermetic)
- `agent-runner/dist/index.js` (generated + committed; **no `agent-runner/src/**` edit**)

**Test criteria (all hermetic — zero DB, zero network, zero LLM):**
- Manifest: serialized fields equal the agent's live config field-for-field, and
  `yaml.parse(...)` → `AgentManifest.safeParse` deep-equals the input — the AC-7 round trip, with a
  multi-line/quote-heavy/`:`-containing system prompt in the fixture (**AC-1, AC-7**); the manifest
  carries `ci_fail_on` verbatim (**AC-54**).
- Exactly one `*.yaml` under `.devdigest/agents/` per bundle (**AC-2**); every `skills[]` slug has a
  matching `.devdigest/skills/<slug>.md`, and `Security Rules` + `security rules` produce two
  distinct files/slugs (**AC-3**, edge case 2); zero skills ⇒ `skills: []` and no skill files.
- `.devdigest/memory.jsonl` present and **empty** when there are no memory rows (**AC-4**); no
  `embedding` field ever serialized.
- `.devdigest/runner/index.js` present with `editable: false` (**AC-5**); `readRunnerBundle` throws a
  `ConfigError` naming the build command when the file is missing.
- No generated file, and no value in the returned `CiFile[]`, contains a configured secret value
  (fixture: a distinctive fake key) (**AC-6**).
- Workflow string assertions: `run: node .devdigest/runner/index.js` present and **no `uses:`
  referencing any review action** (**AC-8**); `types:` equals the sanitized selection and unknown
  trigger strings are dropped (**AC-9**, D9); the `permissions:` block is exactly the three fixed
  lines for **every** `post_as` value (**AC-10**); `pull_request_target` never appears (**AC-11**);
  a fork guard exists at job level (**AC-12**); job id + `name:` are the constants and do not vary
  with the agent (**AC-13**); all five env vars are passed, `DEVDIGEST_POST_AS` reflecting the
  wizard's choice (**AC-14**); the upload step carries `if: always()` (**AC-15**); no step echoes a
  secret (**AC-16**); the only `uses:` entries are the pinned checkout + upload-artifact actions
  (**AC-17**).
- `applyFileOverrides`: an override for an editable generated path wins; an override for the runner
  bundle or an unknown path is dropped; an override that breaks `AgentManifest` falls back to the
  generated manifest (**AC-29** server half, D3).
- `cd agent-runner && pnpm typecheck && pnpm test` still green (proving no source edit), and
  `dist/index.js` exists and is committed.

---

### Wave 2 — Steps 3 and 4 (parallel; disjoint packages)

#### Step 3 — Server services, routes, Actions adapter, DI wiring
**Depends on:** Steps 1 and 2.
**Owns:**
- `server/src/modules/ci/export-service.ts`
- `server/src/modules/ci/ingest-service.ts`
- `server/src/modules/ci/ingest-registry.ts`
- `server/src/modules/ci/routes.ts`
- `server/src/modules/index.ts`
- `server/src/platform/container.ts`
- `server/src/adapters/github/actions.ts`
- `server/src/adapters/mocks.ts`
- `server/test/ci-export.test.ts` (new, hermetic)
- `server/test/ci-ingest.test.ts` (new, hermetic)
- `server/test/ci-export.it.test.ts` (new, real Postgres)
- `server/test/ci-ingest.it.test.ts` (new, real Postgres)

**Test criteria:**
- **Hermetic (`ci-export.test.ts`)** — build the container as a plain object literal cast
  `as unknown as Container` (`ContainerOverrides` does **not** cover `agentsRepo` —
  `server/insights.md`): `action:'files'` performs **zero** GitHub calls and returns `pr_url: null`
  (**AC-21**) with a non-persisted installation (D4); `open_pr` calls `commitFiles` once with the
  full file set on branch `devdigest/ci` based on `base`, and never commits to `base`/the default
  branch (**AC-19**); with `findOpenPr` returning a URL, `openPullRequest` is **not** called and that
  URL is returned (**AC-20**); a `commitFiles` rejection mentioning workflow permission surfaces a
  message naming the `workflow` scope / *Workflows: write* permission and leaves **no** installation
  recorded (**AC-23**); a non-`gha` target is rejected rather than exported (**AC-26** server half);
  the emitted log line carries agent/repo/target/action/branch/PR URL and **no** token or file body
  (§Observability, **AC-6**).
- **Hermetic (`ci-ingest.test.ts`)** — with `MockActionsClient`: a malformed artifact payload is
  rejected by `CiResultArtifact.safeParse` and nothing from it is persisted (**AC-46**); status
  derivation table — in-progress ⇒ `running`; artifact present with findings ⇒ `succeeded` even when
  the run's conclusion is `failure` (gate-blocked, **AC-49**); conclusion `failure` with no artifact
  ⇒ `failed`; artifact with zero findings ⇒ `no_findings`; `skipped`/`cancelled` ⇒ not persisted
  (D6); `github_url` always comes from the run object even when the artifact contains a URL-shaped
  field (**AC-50**); a second `refresh` for the same repo while one is in flight is skipped
  (**AC-53**); an already-ingested terminal run does not trigger an artifact download (D7).
- **Integration (`ci-export.it.test.ts`)** — `POST /agents/:id/export-ci` accepts `CiExportInput`
  and returns `CiExport` (**AC-18**); an export records one `ci_installations` row and a re-export
  updates it rather than duplicating (**AC-22**); an agent id from another workspace is rejected,
  not exported (**AC-24**); source-read assertion that the route declares `rateLimit`.
- **Integration (`ci-ingest.it.test.ts`)** — a pass over a stubbed Actions API lists runs for
  `devdigest-review.yml` and downloads each candidate's artifact (**AC-45**); one pass writes the
  `ci_runs` + `agent_runs` pair (**AC-47**) and a repeat pass updates rather than duplicates
  (**AC-48**); a run whose PR was never imported still persists (**AC-51**); an API error /
  expired artifact leaves previously ingested rows byte-identical and returns the reason to the
  caller (**AC-52**); `GET /ci-runs` returns the joined agent name, repo and duration (**AC-40**);
  `GET /ci-installations` returns each installation with its latest run (**AC-37** server half).
- `cd server && pnpm typecheck && pnpm exec vitest run --exclude '**/*.it.test.ts'` clean.
- Architecture self-check before reporting done: services import no `drizzle-orm`/`db/schema`/
  `fastify`; `routes.ts` calls no `db.*`; `modules/ci/**` reaches agents only via
  `container.agentsRepo`; every route calls `getContext`.
> ⚠️ Same testcontainers caveat as Step 1.

#### Step 4 — Client foundation + Export Wizard
**Depends on:** Step 1 (`lib/types.ts` re-exports). Route paths are fixed by §1C, so there is no
compile-time dependency on Step 3.
**Owns:**
- `client/src/lib/hooks/ci.ts` (new)
- `client/src/lib/hooks/index.ts`
- `client/messages/en/ci.json`  ← **all** keys for this feature, including the ones Step 5 renders
- `client/src/components/ci/**` (new: `ExportWizard/ExportWizard.tsx`, `_components/{TargetStep,PreviewStep,ConfigureStep,InstallStep}.tsx`, `constants.ts`, `helpers.ts`, `styles.ts`, `index.ts`, colocated tests)
- `client/package.json` (add `jszip`)

**Test criteria (RTL; mocked `fetch`/hooks via a static top-level import + `vi.fn().mockReturnValue()` reset in `afterEach` — **not** a module-level `let` + dynamic `import()`, which is flaky here):**
- The wizard renders the four `ExportWizardSteps` labels; choices survive Back → forward
  (**AC-25**); the repo field is a free-text `owner/name` input with **no** repo list fetched
  (**AC-25**, resolved clarification 9).
- Four targets render with descriptions and GHA marked recommended; selecting CircleCI/Jenkins/CLI
  shows the "not available yet" copy and disables Install (**AC-26**).
- A different agent already installed in the typed repo shows a warning naming that agent and blocks
  progress until an explicit confirmation; the **same** agent re-exporting shows no warning
  (**AC-26a**).
- Preview lists all five file kinds with the workflow selected by default; an `editable: true` file
  is marked editable and shows contents (**AC-27**); the runner bundle is neither editable nor
  rendered in the code view (**AC-28**); editing an editable file and installing sends the edited
  contents in the mutation's `files` payload (**AC-29**, client half).
- Configure renders the three trigger checkboxes with the two defaults checked, the three post-as
  options, and the two-row secrets table whose copy states DevDigest has *not* inspected the repo's
  secrets (**AC-30, AC-31**); the merge-blocking callout names Fail-CI-on + branch protection and
  says no GitHub App is needed (**AC-32**).
- Install renders both paths + the docs link; "Copy files as a zip" builds from the already-fetched
  `CiFile[]` (including the runner bundle) with **no** additional network call (**AC-33**); success
  surfaces the PR URL (**AC-34**).
- Every string resolves through a message key — no hard-coded copy — and no state is conveyed by
  colour alone (**AC-35**).
- `cd client && pnpm typecheck && pnpm test` clean.
> **Ownership note:** `messages/en/ci.json` belongs to this step ONLY. Step 5 renders keys but must
> not edit the file — so Step 4 must add the `ciTab.*` and `runs.*` keys §1D lists, not just the
> wizard's. Keys are nested; verify a new key landed in the block you intended (next-intl silently
> falls back to the raw key path — it is never a typecheck error).

---

### Wave 3 — Step 5

#### Step 5 — Agent CI tab + `/ci-runs` page
**Depends on:** Step 4 (hooks + i18n keys). Runtime-depends on Step 3's routes.
**Owns:**
- `client/src/app/agents/[id]/_components/AgentEditor/constants.ts`
- `client/src/app/agents/[id]/_components/AgentEditor/AgentEditor.tsx`
- `client/src/app/agents/[id]/_components/AgentEditor/_components/CiTab/**` (new folder + tests)
- `client/src/app/ci-runs/page.tsx`
- `client/src/app/ci-runs/_components/CiRunsPage/**` (new folder + tests)

**Test criteria (RTL):**
- Opening the editor with `?tab=ci` renders the CI tab and keeps it selected across re-renders —
  the guard for this repo's documented "key in one allowlist but not the other" failure
  (`page.tsx`'s `VALID_TABS` already has `"ci"`, so this passes only if `TABS` **and** the render
  branch were both updated) (**AC-36**).
- The tab shows the header, the installed-in-N-repositories pill, **Update CI config** and
  **+ Add to CI** (**AC-36**); one row per installation with repo, target badge, latest run status
  (text/icon cue, not colour alone) and relative time; zero installations ⇒ empty state with the
  CTA, not an error (**AC-37**).
- The Fail-CI-on selector renders the four options bound to `agent.ci_fail_on` and fires the agent
  update mutation (**AC-38**); the stale-manifest notice is present and does not imply installed
  repos were updated (**AC-39**).
- `/ci-runs` renders a row per run with PR, repo, agent, status, findings, cost, duration and a link
  to the Actions job (**AC-40**); a run with null cost/duration renders the explicit unknown marker,
  never `0` (**AC-41**); zero runs ⇒ the how-runs-arrive empty state (**AC-42**); Refresh calls the
  mutation and shows in-progress state while pending (**AC-43**).
- All strings via message keys; no colour-only status (**AC-35**).
- `cd client && pnpm typecheck && pnpm test` clean.

---

### AC → step traceability (all 55)

| AC | Step(s) | AC | Step(s) |
|---|---|---|---|
| AC-1 | 2 | AC-29 | 2 (server apply) · 4 (client edit) |
| AC-2 | 2 | AC-30 | 4 |
| AC-3 | 2 | AC-31 | 4 |
| AC-4 | 2 | AC-32 | 4 |
| AC-5 | 2 | AC-33 | 4 |
| AC-6 | 2 (files) · 3 (logs/response) | AC-34 | 4 |
| AC-7 | 2 | AC-35 | 4 · 5 |
| AC-8 | 2 | AC-36 | 5 |
| AC-9 | 2 | AC-37 | 3 (server) · 5 (component) |
| AC-10 | 2 | AC-38 | 5 (existing agents route — no server work) |
| AC-11 | 2 | AC-39 | 5 |
| AC-12 | 2 (+ manual fork PR) | AC-40 | 1 (join) · 3 (route) · 5 (render) |
| AC-13 | 2 | AC-41 | 5 |
| AC-14 | 2 | AC-42 | 5 |
| AC-15 | 2 (+ manual) | AC-43 | 5 |
| AC-16 | 2 | AC-44 | 1 |
| AC-17 | 2 (+ manual read-through) | AC-45 | 3 |
| AC-18 | 3 | AC-46 | 3 |
| AC-19 | 3 | AC-47 | 1 (repo/tx) · 3 (pass) |
| AC-20 | 3 | AC-48 | 1 (unique index) · 3 (pass) |
| AC-21 | 3 | AC-49 | 3 |
| AC-22 | 1 (unique index) · 3 (upsert) | AC-50 | 3 |
| AC-23 | 3 | AC-51 | 1 · 3 |
| AC-24 | 3 | AC-52 | 3 |
| AC-25 | 4 | AC-53 | 3 |
| AC-26 | 3 (server reject) · 4 (UI) | AC-54 | 2 (manifest) · DoD (manual) |
| AC-26a | 4 | | |
| AC-27 | 4 | | |
| AC-28 | 4 | | |

---

## 4. Definition of Done (whole feature)

**Automated gate**
- [ ] `cd agent-runner && pnpm typecheck && pnpm test` green with **zero** `src/**` diff; `dist/index.js` built and committed.
- [ ] `cd reviewer-core && pnpm typecheck && pnpm test` green (untouched).
- [ ] `cd server && pnpm typecheck` · `pnpm exec vitest run --exclude '**/*.it.test.ts'` green.
- [ ] `cd client && pnpm typecheck && pnpm test` green.
- [ ] `cd server && pnpm db:generate` reports **zero** drift after the migration is applied.
- [ ] `.it.test.ts` files written + typechecked, and reported as *not executed* if testcontainers is unavailable here.

**Contract integrity**
- [ ] `CiExportInput.files?` is the ONLY change in either vendored `eval-ci.ts`, and the line is identical in both copies.
- [ ] No parallel/duplicate CI contract was created; `AgentManifest`, `CiFile`, `CiRun`, `CiResultArtifact` are unmodified.
- [ ] The generated manifest round-trips through `yaml.parse` + `AgentManifest.safeParse` to a value deep-equal to the agent's live config (AC-7).

**Architecture / security**
- [ ] `modules/ci/{helpers,workflow}.ts` import nothing from `drizzle-orm`, `db/`, `fastify`, or `adapters/`.
- [ ] `modules/ci/*-service.ts` import no `drizzle-orm`/`db/schema`/`fastify`; `routes.ts` calls no `db.*`; agents are reached only via `container.agentsRepo`.
- [ ] `GitHubClient` (vendored port) is **unchanged**; the Actions surface is the module-local `ActionsClient` behind a container getter (D2).
- [ ] Every new route calls `getContext`; the two cost/write-amplifying POSTs declare `rateLimit`.
- [ ] `grep -rn "GITHUB_TOKEN\|OPENROUTER_API_KEY\|secrets.get" server/src/modules/ci` shows **no** secret value in any generated file, response body, or log line (AC-6); the generated workflow reads both from Actions Secrets only and echoes neither (AC-16).
- [ ] Generated workflow: `pull_request` only (never `pull_request_target`), fixed three-line `permissions:`, explicit fork skip, stable job name, `if: always()` upload, no marketplace review action (AC-8/10/11/12/13/15/17).
- [ ] `triggers`, `repo` and `base` are allowlist/regex-validated before reaching the YAML or a git ref (D9); file overrides are path-allowlisted and the runner bundle can never be overridden (D3).
- [ ] Every ingested artifact is `CiResultArtifact.safeParse`d before persistence; `github_url` always comes from the GitHub API; the artifact's `agent` string is rendered as text only (AC-46/AC-50, §Untrusted inputs).

**i18n / a11y**
- [ ] No user-facing literal in `client/src/components/ci`, `client/src/app/ci-runs`, or the `CiTab` folder — everything through `useTranslations("ci")` (AC-35).
- [ ] `exportWizard.blockMergeDesc` no longer claims a GitHub App is required.
- [ ] Every run status carries a text/icon cue, not colour alone; the wizard modal traps focus, is escapable, and its step navigation is labelled; the Preview code view is keyboard reachable.
- [ ] Unknown cost/duration renders an explicit marker, never `0` (AC-41).

**Manual verification (the demo path — this is what "done" means for this feature)**
- [ ] Agent page → **CI** tab → **+ Add to CI** → type `owner/name` → Preview shows all five files, the workflow selected, the runner bundle not previewable → Configure → Install → a PR appears on `devdigest/ci` in the target repo, titled "Add DevDigest CI review".
- [ ] Read the generated workflow line by line and be able to explain every line (US-2 / AC-17).
- [ ] Re-run the wizard for the same agent+repo → the **same** PR is updated, no second PR, no second manifest, unrelated repo files survive (AC-2/AC-20, edge cases).
- [ ] Merge the PR, add `OPENROUTER_API_KEY` to the repo's Actions secrets by hand, open a PR there → the job runs, posts findings, uploads `devdigest-result.json`.
- [ ] Open a fork PR → the job is **skipped**, not failed (AC-12).
- [ ] Studio → **CI Runs** → Refresh → the run appears with PR/repo/agent/status/findings/cost/duration and a working Actions link; the same run shows on the agent's CI tab (AC-40/AC-43/US-7).
- [ ] Refresh twice → no duplicate rows (AC-48); with the API unreachable → an error is reported and existing rows are untouched (AC-52).
- [ ] Set **Fail CI on → critical**, re-export, open a PR carrying a seeded CRITICAL finding with branch protection requiring the "DevDigest Review" check → the merge is blocked, with **no GitHub App** installed (AC-54, US-6).
- [ ] A repo where the secret was NOT added: the run fails, no artifact, ingest records it as `failed` — the expected first-run outcome, not a bug.

**Post-merge**
- [ ] Run `/engineering-insights` and append any substantive, non-obvious learning to the relevant `insights.md` (dedupe first; write nothing if nothing qualifies).

---

## 5. Risks and assumptions

**Risks**

1. **This feature writes executable code into a repository DevDigest does not control.** That is the
   whole supply-chain surface. The mitigations are structural, not optional: it lands as a
   reviewable PR on `devdigest/ci` (never a push to `base`), it embeds a runner that travelled in
   the same diff instead of resolving a marketplace action at run time, its permissions are fixed
   and minimal, and every string that reaches the YAML (`triggers`, `repo`, `base`, `post_as`) is
   allowlist-validated (D9). An Implementer who "just interpolates" `input.triggers` into the
   `types:` list has opened a workflow-injection hole in a third-party repository.
2. **`agent-runner/dist/index.js` does not exist yet and is a build artifact that must be
   committed.** If Step 2 skips the build, every export produces a bundle whose runner file is
   missing or stale, and the failure surfaces only in someone else's CI. `readRunnerBundle`'s
   ConfigError exists so this fails loudly at export time instead.
3. **`pnpm db:generate` has a documented history of proposing phantom changes** from corrupted
   `0011`/`0012` snapshots. Step 1's isolation procedure exists for exactly this. Anything beyond
   the two columns + two indexes ⇒ **stop and report**; do not generate a catch-up migration (that
   was tried before and reverted).
4. **`db.transaction(...)` is a first for this codebase** (grep-confirmed: zero existing call
   sites). Drizzle/postgres-js supports it, but if it misbehaves under the test harness, the
   fallback is insert-`agent_runs`-then-`ci_runs`-then-link with an explicit compensating delete —
   do **not** silently drop to two unguarded writes, since AC-47's whole point is the pair can never
   drift.
5. **The two vendored `shared` copies are already drifted.** A well-meaning "sync the files" would
   drag `AgentManifest`/`CiFailOn` into the client build. Step 1 mirrors exactly one line.
6. **The nav-key near-miss has already shipped twice in this repo** (`eval` vs `eval-dashboard`,
   including a runtime `IntlError` from the command palette's dynamic `t(\`nav.${it.key}\`)`).
   `"ci-runs"` must match across `nav.ts`, `activeKeyFor` (already correct) and
   `messages/en/shell.json` (already correct) — diff the exact string, don't eyeball it.
7. **`.it.test.ts` files cannot run in this sandbox.** Four of this plan's test files are DB-backed.
   Write, typecheck, and state their non-execution in the summary rather than skipping silently.
8. **Ingest burns someone's GitHub rate limit if the skip-list is skipped.** Each ingested run costs
   ≥3 requests (list runs → list artifacts → 302 + ZIP download). D7's "only re-fetch `running`
   rows" rule plus `MAX_RUNS_PER_PASS` is the entire budget mechanism; a Refresh button that
   re-downloads every artifact every click is a real (if slow-burning) defect.
9. **An implementer worktree can finish a step without committing it** — `git merge --no-ff` then
   reports "Already up to date" and the work silently vanishes from the integration branch (root
   `insights.md`). Commit inside each worktree before integrating, and confirm the plan's baseline
   files from earlier steps are actually present before starting a later one.

**Assumptions**

1. **One API instance per DB** — already assumed by the orphan-run reaper (`server/AGENTS.md`); the
   in-process ingest registry (AC-53) inherits it. Replicas would allow two concurrent passes for
   one repo.
2. **GitHub Actions is the only target that must work.** CircleCI/Jenkins/Generic CLI are selectable
   and explicitly marked unavailable; the server rejects them rather than faking an install
   (spec Non-goals, resolved clarification 10).
3. **Ingest is user-triggered only** (refresh + on page load). No poller, no `workflow_run` webhook —
   a webhook needs a publicly reachable receiver this iteration does not have (resolved
   clarification 4).
4. **`.devdigest/memory.jsonl` is exported but never read** by the runner today (grep-confirmed) —
   it ships for bundle completeness/forward compatibility only (spec Non-goals). Do not build a
   memory reader.
5. **Only the `en` locale exists**, so AC-35 means "goes through `useTranslations`", not "is
   translated".
6. **A repository can run exactly one DevDigest agent in CI.** `agent-runner` hard-fails on ≠ 1
   manifest, so export replaces (AC-2) and the wizard warns + confirms first (AC-26a). Bumping an
   installed repo means re-running the wizard for that repo — there is no bulk updater.
7. **Verification of the *Verify: e2e* criteria is RTL + manual** (D8), not new `e2e/` flows.
