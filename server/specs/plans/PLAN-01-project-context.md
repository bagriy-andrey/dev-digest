# Implementation Plan: Project Context (SPEC-01)

**Status:** planning
**Scope:** reviewer-core · server (`@devdigest/api`) · client (`@devdigest/web`)
**Spec:** `server/specs/SPEC-01-project-context.md` (source of truth for WHAT — do not re-litigate behavior here)
**Execution mode:** single-agent (recommended) — see note in §3. Client screen steps 7/8/9 are parallelizable if switched to multi-agent.

> This document is HOW to build an already-specced feature, file-by-file, in
> dependency order. Every step lists the exact files it owns; no two steps share
> a file. The Implementer executes one step at a time.

## Resolved clarifications (do NOT re-ask — decided before planning)

- **No hard token cap** on the assembled `## Project context` block. The pre-run
  token estimate (AC-12) is the only guardrail; nothing is truncated.
- **COVERAGE % denominator = ALL workspace agents** (enabled AND disabled). The
  "Used by N agents" numerator counts the same population. Zero agents → badge `0`.
- **Discovery runs only on the manual reindex trigger** (AC-4). It is NOT run
  automatically on every repo resync. (The discovery function is reusable at
  clone/resync time later, but this feature does not wire that path.)

## Assumptions the Implementer must honor

- **Attachments store repo-relative PATHS only, with no repo binding.** An
  `agent_context_docs` / `skill_context_docs` row is `(owner, path, order)` — it
  does not reference a `repo_id`. At run time each path is read from the PR's own
  repo clone; a path that doesn't resolve there is an AC-19 skip. The Agent/Skill
  Context tabs populate their discovered-doc picker from the client's **active
  repo** (`useActiveRepo`). Dedup and "Used by N agents" are keyed by full path.
  (This is the direct reading of the spec's "paths only — never baked-in text"
  and "dedup is by full path". See §5 for the one open question this raises.)
- **The run-trace UI needs ZERO client changes** — see §0.

---

## 0. What already exists (do not touch / do not rebuild)

| Artifact | Location | State |
|---|---|---|
| `## Project context` prompt block + `wrapUntrusted` | `reviewer-core/src/prompt.ts:101-104,146` | Built. Only the block ORDER is wrong (AC-17) — that is the one edit. |
| `specs?: string[]` prompt slot | `reviewer-core/src/prompt.ts:47` | Built; omitted when empty. Don't make it required. |
| `PromptAssembly.specs` (captured injected text) | `contracts/trace.ts:43` | Built. Surfaces AC-22 with no further work once populated. |
| `RunTrace.specs_read` | `contracts/trace.ts:89` | Built (currently `z.array(z.string())`). Populated by run-executor for AC-21. |
| `SpecFile` contract | `contracts/platform.ts:278` | Built (`{path,content?,size?,updated_at?}`). Extended with `source_type` in step 2. |
| Client hooks `useContextFiles` / `useReindexContext` | `client/src/lib/hooks/core.ts:123-137` | Built; point at not-yet-existing routes. Return types updated in step 6. |
| i18n namespace `context` | `client/messages/en/context.json` | Exists — REUSE it, extend keys. Do not create a new namespace. Drop the `mode.edit` / `editor.*` keys (view-only, AC-6). |
| Trace "Specs read" row + "Project context" prompt block | `client/.../RunTraceDrawer/_components/TraceBody/TraceBody.tsx:39-51,85-87` | Already renders `trace.specs_read` and `prompt_assembly.specs`. **AC-21 + AC-22 need no client work** — only server population. |
| `db/schema/context.ts` | server | Exists (code_chunks/symbols/references/onboarding). EXTENDED in step 3; do not touch the embedding/RAG tables. |
| DnD attach/reorder precedent | `client/.../AgentEditor/_components/SkillsTab/SkillsTab.tsx` | Mirror this (`@dnd-kit`, `GripHandle`, optimistic order, keyboard-accessible) for the Context tabs. |
| `agent_skills` link precedent (order + enabled) | `server/src/modules/agents/repository.ts:199-250` | Mirror the shape for the new doc-link tables. Do NOT add methods to `AgentsRepository` — the new module owns doc links. |
| `Markdown` UI primitive | `client/src/vendor/ui/primitives/Markdown.tsx` | Reuse for the Project Context Preview panel (as `PreviewTab` already does). |
| Dead RAG scaffold (`code_chunks`, `IndexStatus.'embedding'`, `embedder`) | server | Stays dead. The footer "chunks" count is a deterministic HEADING count — do not wire embeddings (preserves "zero new LLM calls"). |

---

## 1. Module breakdown (dependency order: reviewer-core → shared → server → client)

### 1A. reviewer-core

**Modify** `reviewer-core/src/prompt.ts`
- Move the `## Project context` (`specsBlock`) push to BEFORE the `## Repo skeleton`
  (`repoMap`) push in `assemblePrompt` (currently lines 143-146: repoMap then specs;
  target: specs then repoMap). Final user-section order must be:
  System → Skills → (Memory) → **Project context** → Repo skeleton → Callers → Diff (AC-17).
- Update the `repoMap` field doc-comment (lines 48-53) which currently claims it is
  "Rendered before `## Project context` so the model sees structure first" — reverse
  the wording to match the new order.
- No signature/type change. `assembly.specs` capture is unchanged.

### 1B. Shared contracts (VENDORED — edit BOTH copies by hand, keep byte-identical)

Copies: `server/src/vendor/shared/contracts/*` AND `client/src/vendor/shared/contracts/*`.

**Modify** `contracts/platform.ts`
- Extend `SpecFile`: add `source_type: z.enum(['specs','docs','insights']).nullish()`
  (nullish, per the vendored-contract "don't break existing literals" convention —
  and `server/test/contracts.test.ts` round-trips these literals; a required field
  would break it).
- Add new `ContextDoc` contract (the enriched page/tab row):
  `{ path, source_type, size, headings, used_by, coverage }` — `size`/`headings`
  `z.number().int()`, `used_by` int, `coverage` int (0–100).
- Add new `ContextIndexStatus` contract for the reindex response (deterministic,
  NO `'embedding'` phase — do not reuse `IndexStatus`):
  `{ files: z.number().int(), chunks: z.number().int(), scanned_at: z.string() }`.
- Add new `ContextAttachment` contract for the attach list: `{ path: z.string(), order: z.number().int() }`.
- Add new `ContextFileContent` for the Preview fetch: `{ path: z.string(), content: z.string() }`.

**Modify** `contracts/trace.ts`
- Add `specs_tokens: z.number().int().nullish()` to `RunStats` (AC-23). MUST be
  `.nullish()` — historical `run_traces.trace` jsonb docs predate it and are returned
  as-is (per the insights rule on jsonb-doc fields).

### 1C. Server — new module `server/src/modules/context/`

Follows the standard `repository → service → routes` module shape (like `skills`).
The service is news-up'd in routes and in run-executor (`new ContextService(container)`),
NOT added to the DI container (matches the skills-module precedent — avoids container churn).

**New** `modules/context/constants.ts`
- `export const DEFAULT_CONTEXT_FOLDERS = ['specs','docs','insights'] as const;` (AC-3 default).

**New** `modules/context/discovery.ts` — pure, hermetically testable, no DB
- `discoverDocs(cloneBasePath: string, folders: readonly string[]): Promise<DiscoveredDoc[]>`
  where `DiscoveredDoc = { path, source_type, size, headings }`.
- Implementation: `fs.readdir(cloneBasePath, { recursive: true, withFileTypes: true })`
  (Node 22 stable — do NOT add a glob dependency; none exists in server deps). Keep
  files whose path has a segment in `folders` AND ends in `.md`. For each: `size` =
  byte length; `headings` = count of lines matching `/^#{1,6}\s/` (ATX headings, AC-9);
  `source_type` = the matched folder name (AC-2); `path` = repo-relative (POSIX
  separators). Empty/missing clone dir → return `[]` (AC edge: graceful degradation).
- **Security (path safety):** normalize and reject any resolved path that escapes
  `cloneBasePath` (defense in depth even though readdir stays inside it).

**New** `modules/context/repository.ts` — `ContextRepository(db)`
- `getAgentDocs(agentId): Promise<{path,order}[]>` (order asc).
- `setAgentDocs(agentId, paths: string[]): Promise<void>` — delete-all + insert with
  `order = index` (mirror `AgentsRepository.setSkills`).
- `getSkillDocs(skillId)` / `setSkillDocs(skillId, paths)` — same shape.
- `allAgentDocs(workspaceId): Promise<Map<agentId, string[]>>` and
  `allSkillDocs(workspaceId): Promise<Map<skillId, string[]>>` — for metrics.
- `getScanState(repoId)` / `upsertScanState(repoId, {files,chunks,scannedAt})` against
  `repo_context_index` (footer timestamp).

**New** `modules/context/service.ts` — `ContextService(container)`
- `listForRepo(workspaceId, repoId): Promise<ContextDoc[]>` — resolve repo → `RepoRef`
  (`RepoRepository.getById`), glob via `discoverDocs(container.git.clonePathFor(ref), folders)`,
  then compute per-doc metrics (see below). Degrade to `[]` if repo/clone missing.
- `getFileContent(workspaceId, repoId, path): Promise<ContextFileContent>` — **path-guard
  first** (reject `..`, absolute, and any path NOT in the current discovered set), then
  `container.git.readFile(ref, path)`. This route is a path-traversal sink — the guard
  is mandatory (consult `security`).
- `reindex(workspaceId, repoId): Promise<ContextIndexStatus>` — re-glob, `upsertScanState`
  (files = N docs, chunks = Σ headings, scannedAt = now), return the status.
- Attachment passthroughs: `getAgentDocs`/`setAgentDocs`/`getSkillDocs`/`setSkillDocs`.
- **Metrics (AC-7/AC-8):** build `Map<path, usedBy>` where a doc is "used by" an agent
  when `path ∈ agent.directDocs` OR `path ∈ anyEnabledLinkedSkill.docs`. Enabled-skill
  gating reuses `container.agentsRepo.linkedSkills(agentId)` filtered `link.enabled &&
  skill.enabled` (same rule as run-executor skill injection). `coverage =
  totalAgents === 0 ? 0 : Math.round(usedBy / totalAgents * 100)`, `totalAgents` = ALL
  workspace agents (`agentsRepo.list`).
- **`resolveEffectiveSpecs(ref, agent, log): Promise<{ specs: string[]; read: string[];
  skipped: string[] }>`** (AC-14/15/16/19) — used by run-executor:
  1. direct docs (ordered) from `getAgentDocs(agent.id)`.
  2. for each enabled linked skill (in agent skill order), that skill's docs (in skill
     order) from `getSkillDocs`.
  3. union in that order; **dedup by path, agent-direct position wins** (AC-15).
  4. for each path: **path-guard**, then `container.git.readFile(ref, path)`; success →
     push `{path}` to `read` and the injected text to `specs`; failure → push to
     `skipped`, log, continue (AC-19 — never fail the run).
  5. **Injection format:** each `specs[i]` = `Path: ${path}\n\n${rawContent}` so the
     model can cite the source (helps AC-24). reviewer-core wraps each in
     `<untrusted source="spec-N">` (AC-16 per-doc delimiter, AC-20 untrusted).

**New** `modules/context/routes.ts` — default Fastify plugin, Zod schemas via
`fastify-type-provider-zod` (validates request AND serializes response — don't hand-roll `.parse`)
- `GET  /repos/:id/context`               → `ContextDoc[]`
- `GET  /repos/:id/context/file` (query `path`) → `ContextFileContent`  ← path-guarded
- `POST /repos/:id/context/reindex`       → `ContextIndexStatus`
- `GET  /agents/:id/context`              → `ContextAttachment[]`
- `PUT  /agents/:id/context` (body `{paths: string[]}`) → `ContextAttachment[]`
- `GET  /skills/:id/context`              → `ContextAttachment[]`
- `PUT  /skills/:id/context` (body `{paths: string[]}`) → `ContextAttachment[]`
- All workspace-scoped via `getContext(app.container, req)` (like skills routes).

**Modify** `modules/index.ts` — add `import context from './context/routes.js';` and one
`context,` entry in the `modules` record. (Only this step touches this file.)

### 1D. Server — run-time wiring

**Modify** `modules/reviews/agent-runner.ts`
- Add optional `specs?: string[]` to `RunAgentReviewOpts`.
- Forward it to `reviewPullRequest` with the same conditional-spread pattern as the
  other optional slots: `...(opts.specs && opts.specs.length > 0 ? { specs: opts.specs } : {})`.
  (Note the insights caveat: conditional-spread bypasses excess-property checks — this is
  safe here because reviewer-core's `specs?` already exists.)

**Modify** `modules/reviews/run-executor.ts`
- In `runOneAgent`, before calling `runAgentReview`: build `ref` from `repo`
  (`{owner: repo.owner, name: repo.name}`), then
  `const { specs, read, skipped } = await new ContextService(this.container).resolveEffectiveSpecs(ref, agent, runLog);`
  Log "Project context: N doc(s) read, M skipped".
- Pass `specs` into `runAgentReview(... , { ..., specs })`.
- After the run: `const specsTokens = outcome.assembly.specs ? this.container.tokenizer.count(outcome.assembly.specs) : 0;`
  (AC-23 — measured with the SAME tokenizer as everywhere else).
- In the success `trace`: set `specs_read: read` (AC-21; currently hardcoded `[]` at
  line 253) and `stats.specs_tokens: specsTokens` (AC-23). Leave the failure/cancel
  `traceFromBuffer` path emitting `specs_read: []` / no specs_tokens.

### 1E. Client

**Modify** `client/src/lib/hooks/core.ts`
- Change `useContextFiles` return type `SpecFile[]` → `ContextDoc[]`.
- Change `useReindexContext` mutation return type `IndexStatus` → `ContextIndexStatus`,
  and its route stays `POST /repos/:id/context/reindex`.

**New** `client/src/lib/hooks/context.ts` — TanStack Query hooks (through `lib/api.ts`):
- `useContextFile(repoId, path)` → `GET /repos/:id/context/file?path=` (Preview, on-demand).
- `useAgentContextDocs(agentId)` → `GET /agents/:id/context`.
- `useSetAgentContextDocs()` → `PUT /agents/:id/context`, invalidates `["agent-context", agentId]`
  and `["context", repoId]` (metrics change).
- `useSkillContextDocs(skillId)` / `useSetSkillContextDocs()` → skill equivalents.

**New** `client/src/app/repos/[repoId]/context/page.tsx` + `_components/**` (Screen 1)
- Client component. Left: doc list by filename + file icon, grouped/badged by
  `source_type` (AC-5). Right: view-only `Markdown` Preview of the selected doc via
  `useContextFile` (AC-6 — NO edit affordance). Selected-doc header: "Used by N agents"
  pill (AC-7) + "COVERAGE %" badge (AC-8) from the `ContextDoc` fields. Footer status
  bar: "Indexed: N files · M chunks · last <relative> ago" (AC-9) + a Re-index button
  (`useReindexContext`, AC-4). Empty state (no docs) per edge-cases. All strings via the
  `context` i18n namespace.

**Modify** app-shell nav (`client/src/components/app-shell/constants.ts` + `helpers.ts`)
- Add a repo-scoped "Project Context" nav item routing to `/repos/${repoId}/context`
  under the `<owner>/<repo>` breadcrumb (AC-5). Update `activeKeyFor` in `helpers.ts`
  to light it up for `/context` paths.

**Modify** `client/messages/en/context.json`
- Add keys: `usedBy` ("Used by {count} agents"), `coverage` ("COVERAGE"),
  `indexed` ("Indexed: {files} files · {chunks} chunks · last {ago} ago"), source-type
  badge labels. Remove the now-unused `mode.edit` / `editor.*` keys (view-only).

**New** `client/src/app/agents/[id]/_components/AgentEditor/_components/ContextTab/**` (Screen 2)
- Mirror `SkillsTab` DnD structure. One row per DISCOVERED doc (from `useContextFiles`
  on the active repo — not only attached), each with drag handle, attach/detach
  checkbox, filename, source-folder badge, Preview affordance (AC-10). Reorder via drag
  persists (AC-11) through `useSetAgentContextDocs`. Header badge "X of Y attached".
  Footer: approximate token count = `Σ size(checked docs) / 4` (client char/4 heuristic;
  the authoritative measured value is server-side AC-23) + the fixed note "Injected as
  an untrusted block (`## Project context`) into every run." (AC-12). Keyboard-accessible
  DnD + accessible labels (a11y non-functional req).

**Modify** `client/src/app/agents/[id]/_components/AgentEditor/constants.ts` + `AgentEditor.tsx`
- Add `{ key: "context", labelKey: "editor.tabs.context", icon: "FileText" }` to `TABS`.
- Render `<ContextTab agent={agent} />` when the context tab is active.

**Modify** `client/messages/en/agents.json`
- Add `editor.tabs.context` + Context-tab strings (attached badge, token note).

**New** `client/src/app/skills/_components/SkillsPage/_components/ContextTab/**` (Screen 3)
- Same row style as Screen 2 with an "X attached" header badge, helper text "Any agent
  using this skill inherits these documents.", and a read-only "SERIALIZES AS" box
  listing the paths this skill contributes (AC-13). Uses `useSkillContextDocs` /
  `useSetSkillContextDocs`.

**Modify** `client/src/app/skills/_components/SkillsPage/SkillDetailPanel.tsx` + `constants.ts`
- Add a `context` entry to `DETAIL_TABS` and `{activeTab === "context" && <ContextTab skill={skill} />}`.

**Modify** `client/messages/en/skills.json`
- Add Context-tab strings.

---

## 2. Dependency changes

- **DB migration (net-new persistence).** After writing `db/schema/context.ts` additions
  (step 3), run `cd server && pnpm db:generate` then `pnpm db:migrate`. Never hand-edit
  `src/db/migrations/*`. New tables:
  - `agent_context_docs` — `(agent_id uuid FK→agents onDelete cascade, path text, "order" int notNull default 0)`, PK `(agent_id, path)`. Mirror `agent_skills`.
  - `skill_context_docs` — `(skill_id uuid FK→skills onDelete cascade, path text, "order" int notNull default 0)`, PK `(skill_id, path)`.
  - `repo_context_index` — `(repo_id uuid PK FK→repos onDelete cascade, files int notNull default 0, chunks int notNull default 0, scanned_at timestamptz notNull default now())`.
  - Also register all three in the `schema` object in `db/schema.ts`.
  - **Before generating**, follow the insights isolation dance if `db:generate` proposes
    anything unrelated (stale-snapshot risk): temporarily move the new file out, run
    once, restore, run again. Do NOT generate a catch-up migration for a phantom column.
- **No new npm packages.** Discovery uses Node 22 `fs.readdir({recursive:true})`;
  DnD/`@dnd-kit` already present; `Markdown` primitive already vendored.
- **No new env vars, no new secrets, no outbound calls, no LLM/embedding calls** (AC-18).
- **Vendored `@devdigest/shared`** contract edits (step 2) MUST be mirrored by hand in
  BOTH `server/src/vendor/shared` and `client/src/vendor/shared` — they are not npm.

---

## 3. Execution order

**Single-agent recommended** because of two cross-cutting gotchas the insights call out:
vendored-shared must be synced by hand across packages, and server `typecheck` pulls
reviewer-core source into its program. A sequential pass keeps those in lockstep. If you
switch to multi-agent, steps 7/8/9 (client screens) are the only safely-parallel set —
they own disjoint files and all depend only on step 6.

Each step lists the exact files it OWNS (disjoint across steps).

**Step 1 — reviewer-core block reorder (AC-17).** Depends on: none.
Owns: `reviewer-core/src/prompt.ts`, `reviewer-core/src/prompt.test.ts` (or the existing prompt spec).
Done when: a unit test asserts user-section order is Skills → Project context → Repo skeleton
→ Callers → Diff; `npm run typecheck` + `npm test` green in reviewer-core.

**Step 2 — shared contracts (both vendored copies).** Depends on: none.
Owns: `server/src/vendor/shared/contracts/platform.ts`, `server/src/vendor/shared/contracts/trace.ts`,
`client/src/vendor/shared/contracts/platform.ts`, `client/src/vendor/shared/contracts/trace.ts`.
Done when: both copies byte-identical for the changed sections; `SpecFile.source_type`,
`ContextDoc`, `ContextIndexStatus`, `ContextAttachment`, `ContextFileContent`, and
`RunStats.specs_tokens` exist; server + client `pnpm typecheck` green;
`server/test/contracts.test.ts` still passes (new fields are nullish → existing literals OK).

**Step 3 — DB schema + migration.** Depends on: none (but land before step 4).
Owns: `server/src/db/schema/context.ts`, `server/src/db/schema.ts`, the generated
`server/src/db/migrations/00XX_*.sql` + snapshot/journal.
Done when: `pnpm db:generate` produces exactly the three new tables (no phantom drift),
`pnpm db:migrate` applies clean, `pnpm typecheck` green.

**Step 4 — server context module.** Depends on: 2, 3.
Owns: `server/src/modules/context/{constants,discovery,repository,service,routes}.ts`,
`server/src/modules/index.ts`, `server/test/context.test.ts` (hermetic),
`server/test/context.it.test.ts` (real PG).
Done when: hermetic unit tests pass for discovery (AC-1/2/3), heading count (AC-9),
effective-set union/dedup/order (AC-14/15), coverage math (AC-8), path-guard rejection;
`pnpm typecheck` green. (`.it.test.ts` may not run in this sandbox — testcontainers
limitation; verify by close reading + hermetic suite, note it in the summary.)

**Step 5 — run-time injection wiring.** Depends on: 1, 2, 4.
Owns: `server/src/modules/reviews/run-executor.ts`, `server/src/modules/reviews/agent-runner.ts`.
Done when: run-executor resolves + reads the effective set, passes `specs`, and persists
`specs_read` (AC-21) + `stats.specs_tokens` (AC-23); a hermetic test asserts the trace
carries read paths and skips a missing path (AC-19) without failing; `pnpm typecheck` green.

**Step 6 — client hooks.** Depends on: 2.
Owns: `client/src/lib/hooks/context.ts` (new), `client/src/lib/hooks/core.ts` (type updates only).
Done when: hooks typecheck against the new contracts; `pnpm typecheck` green.

**Step 7 — client Project Context page (Screen 1) + nav.** Depends on: 6.
Owns: `client/src/app/repos/[repoId]/context/**`, `client/src/components/app-shell/constants.ts`,
`client/src/components/app-shell/helpers.ts`, `client/messages/en/context.json`,
+ the page's test file.
Done when: page lists docs, Preview renders markdown view-only, header shows Used-by +
COVERAGE, footer shows Indexed counts + Re-index, empty state renders; RTL test (mocked
fetch) passes; `pnpm typecheck` + `pnpm test` green.

**Step 8 — client Agent Context tab (Screen 2).** Depends on: 6.
Owns: `client/src/app/agents/[id]/_components/AgentEditor/_components/ContextTab/**`,
`client/src/app/agents/[id]/_components/AgentEditor/constants.ts`,
`client/src/app/agents/[id]/_components/AgentEditor/AgentEditor.tsx`,
`client/messages/en/agents.json`.
Done when: rows for all discovered docs with attach/detach + keyboard-accessible reorder
persist; token-estimate footer + fixed note render; RTL test passes; typecheck/test green.

**Step 9 — client Skill Context tab (Screen 3).** Depends on: 6.
Owns: `client/src/app/skills/_components/SkillsPage/_components/ContextTab/**`,
`client/src/app/skills/_components/SkillsPage/SkillDetailPanel.tsx`,
`client/src/app/skills/_components/SkillsPage/constants.ts`,
`client/messages/en/skills.json`.
Done when: skill Context tab renders shared row style + "SERIALIZES AS" box; attach
persists; RTL test passes; typecheck/test green.

> Steps 7, 8, 9 have disjoint file ownership and depend only on step 6 → parallelizable.
> Steps 1, 2, 3 are independent of each other and could all go first.

---

## 4. Definition of Done (whole feature)

- [ ] `reviewer-core`: `npm run typecheck` + `npm test` green; prompt order test asserts AC-17.
- [ ] `server`: `pnpm typecheck` green; `pnpm exec vitest run --exclude '**/*.it.test.ts'`
      green (discovery, source-type, folder-set config, heading count, effective-set
      union/dedup/order, coverage, path-guard). `.it.test.ts` written + typechecked
      (execution blocked by sandbox testcontainers limit — note in summary).
- [ ] `server`: `pnpm db:generate` reports zero drift after migration; `pnpm db:migrate` clean.
- [ ] `client`: `pnpm typecheck` + `pnpm test` green (three new screen tests, mocked fetch).
- [ ] Vendored `@devdigest/shared` changes identical in server + client copies (diff to confirm).
- [ ] Manual: import a repo with `specs/`/`docs/`/`insights/` markdown → Project Context
      page lists them with correct source badges + footer counts; attach a doc to an
      agent, reorder, see token estimate; run a review → run trace shows "Specs read"
      paths + the exact injected "Project context" block; delete an attached doc upstream,
      re-run → doc is skipped, run completes (AC-19); zero new LLM/embedding calls.
- [ ] Governance demo (AC-24, manual): attach an invariant spec to a reviewer, review a
      violating PR, confirm the finding cites the spec.
- [ ] Edge cases: no docs (empty state, "0 files · 0 chunks", no `## Project context`
      block injected); duplicate filenames in different folders treated as distinct paths;
      doc reached via two enabled skills + direct attach appears once, agent-direct order.

---

## 5. Risks and assumptions

- **Open question (non-blocking) — attachment repo binding.** This plan stores attached
  paths WITHOUT a `repo_id` (agents/skills are workspace-scoped; paths are matched
  against whichever repo the PR is in at run time; the Context tabs pick from the active
  repo's discovered docs). This is the literal reading of the spec's "paths only" +
  "dedup by full path". If the product intent is instead per-repo attachment sets (an
  agent attaches `x.md` for repo A but not repo B), the two link tables need a `repo_id`
  column and the tabs/metrics need a repo selector. **Flagged for confirmation before
  step 3** — it only affects the schema shape and the tab data source, not the rest of
  the plan. Defaulting to path-only.
- **Path-traversal sink.** `GET /repos/:id/context/file` and the run-time `readFile` take
  a user/DB-supplied path. Both MUST reject `..`/absolute paths and confirm membership in
  the current discovered set before reading (baked into `ContextService` in step 4).
- **Prompt injection.** Doc content is attacker-influenceable. It is injected ONLY inside
  `wrapUntrusted` and covered by the existing `INJECTION_GUARD` — do NOT add denylist/
  keyword scanning of doc text (per the reviewer-core invariant and the spec's Untrusted
  Inputs section).
- **Client token estimate ≠ server measurement.** AC-12 (client) uses a `size/4` heuristic
  (no tiktoken on the client); AC-23 (server) is the tiktoken-measured truth. This
  intentional divergence should be reflected in copy/tests (estimate vs measured).
- **Stale-snapshot `db:generate` trap.** Per insights, if `db:generate` proposes an
  unrelated column change, suspect stale snapshot metadata — do not generate a catch-up
  migration; isolate the new schema file first.
- **`.it.test.ts` cannot run in this sandbox** (testcontainers/Rancher limitation) — write
  and typecheck them, verify logic by reading + the hermetic suite, and say so in the
  summary rather than debugging a container-runtime error.
