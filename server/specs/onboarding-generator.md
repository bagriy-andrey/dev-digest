# Implementation Plan: Onboarding generator

**Status:** planning
**Scope:** `server/` (business logic + routes + repo-intel facade addition) and `client/` (tour screen). Owned by `server/` per the "module owning most of the business logic" convention (mirrors `server/specs/skills.md`).
**Execution mode:** single-agent (recommended — the steps form a near-total sequential chain; only steps 1 and 2 are mutually independent, and both are small)
**Realizes:** `specs/SPEC-01-onboarding-generator.md` (AC-1 … AC-20)

> Planner decisions resolving the spec's `[NEEDS CLARIFICATION]` block (all non-blocking, confirmed here so the Implementer does not re-ask):
> - **(A) Routes & APIs facts** → a new repo-wide facade method `RepoIntel.getRepoEndpoints(repoId)` reading the persisted `file_facts` table, NOT deriving from `getRepoMap`. Rationale: `getRepoMap`'s text is a file-tree skeleton with no route data, so deriving Routes & APIs from it would force the LLM to invent routes from filenames (weakly grounded; AC-9's link-drop backstop validates link paths, not route strings). `file_facts.endpoints` already holds the real extracted endpoints repo-wide. This satisfies AC-4's "facade only, no ad hoc full-tree read." One real `RepoIntel` implementor exists (`RepoIntelService`), so the interface change is low blast-radius.
> - **(B) Regenerate concurrency** → no locking, last-write-wins, per spec default and the one-row-per-repo model (AC-12). See §5.
> - **(C) Manifest filename variants** → a fixed `MANIFEST_FILE_CANDIDATES` array in the onboarding module's `constants.ts`, mirroring the conventions module's `CONFIG_FILE_CANDIDATES` + `readFileIfExists`/`truncate` + `MAX_CONFIG_LINES` style. See §1 step 3.

---

## 0. What already exists (do not touch / reuse as-is)

| Artifact | Location | Reuse |
|---|---|---|
| `onboarding` table `{ repoId(PK), json, generatedAt }` | `server/src/db/schema/context.ts` | Extend with 2 columns (step 1); do not recreate. FK already `onDelete: 'cascade'`. |
| `Onboarding` / `OnboardingSection` / `OnboardingLink` Zod contracts | `server/src/vendor/shared/contracts/knowledge.ts` (+ client copy) | Use `Onboarding` verbatim as the `completeStructured` schema and the persisted `json` shape. `OnboardingSection.kind` is a free `z.string()`; this feature fixes it to 5 values in code, not by editing the contract. |
| System prompt `onboarding.system.md` (`{{sections}}`, `{{language}}`, `<untrusted>` clause, diagram + no-fabrication rules) | `server/src/prompts/onboarding.system.md` | Load via `renderPrompt('onboarding.system.md', {...})`. No rewrite. |
| `'onboarding'` `FeatureModelId` (default `openrouter`/`deepseek/deepseek-v4-flash`) | `server/src/vendor/shared/contracts/platform.ts` | Resolve via `resolveFeatureModel(container, workspaceId, 'onboarding')`. |
| repo-intel facade: `getIndexState`, `getRepoMap`, `getTopFilesByRank`, `getCriticalPaths` | `server/src/modules/repo-intel/{types,service}.ts` | Call as-is. Array methods return `[]` when degraded/off; object methods carry `degraded?`. |
| Prompt loader `loadPromptTemplate` / `renderPrompt` / `renderTemplate` | `server/src/platform/prompts.ts` | `{{var}}` mustache-replace, cached. |
| `wrapUntrusted(...)` | re-exported from `server/src/platform/prompt.js` (origin `@devdigest/reviewer-core`) | Wrap every raw-text fact (manifest contents, repo-map text, endpoint list) before assembly (Untrusted-inputs mitigation). |
| `resolveFeatureModel` | `server/src/modules/settings/feature-models.ts` | Returns `{ provider, model }`. |
| `getContext(container, req)` → `{ workspaceId }`, `IdParams` | `server/src/modules/_shared/{context,schemas}.ts` | Route boilerplate, same as conventions. |
| `StructuredResult<T>` (`data`, `tokensIn`, `tokensOut`, `costUsd: number\|null`) | `server/src/vendor/shared/adapters.ts` | `costUsd` feeds AC-11 cost-in-cents. `onboarding` defaults to OpenRouter, which populates `costUsd`. |
| `repos.clonePath` / `repos.defaultBranch` | `server/src/db/schema/repos.ts` | Read clone path for manifest reads (mirror `ConventionsService.extract`). |
| Client: `Markdown` primitive, `MermaidDiagram`, `useRepoIntelStatus` (index-state hook), `useActiveRepo`/`useRepoNotFound`, `AppShell` | `client/src/vendor/ui/primitives/Markdown.tsx`, `client/src/components/mermaid-diagram/MermaidDiagram.tsx`, `client/src/lib/hooks/repo-intel.ts`, `client/src/lib/repo-context.tsx`, `client/src/components/app-shell` | Reuse. `useRepoIntelStatus(repoId).data.lastIndexedSha` drives the AC-14 staleness compare client-side. |
| Client nav routing already anticipates onboarding | `client/src/components/app-shell/helpers.ts` `activeKeyFor()` → returns `"onboarding-tour"` for `/onboarding` paths | The nav ITEM still must be added to `vendor/ui/nav.ts` (step 5); the highlight branch already exists. |
| Client i18n scaffold | `client/messages/en/onboarding.json` (title, `sectionCount`, `regenerate`, `generate.*`, `loadError.*`, `unknownError`) | Extend with stale-indicator + copy-link + section-title keys (step 5); do not recreate. |

**Confirmed absent (this feature builds these):** `modules/onboarding/`, any read/write of the `onboarding` table, any caller of the `'onboarding'` feature model or `onboarding.system.md`, any repo-wide endpoints facade method, the client `/repos/:repoId/onboarding` route + hook + nav entry.

---

## 1. Module breakdown (dependency order: repo-intel + shared → server module → client)

### Step 1 files — shared contract + schema (`server/`)

**Modify `server/src/vendor/shared/contracts/knowledge.ts`** — add the route-response contract next to the existing `Onboarding` block:
```ts
export const OnboardingDoc = z.object({
  onboarding: Onboarding.nullable(),   // null = never generated (AC-17 empty state)
  source_sha: z.string().nullable(),   // generation-time index SHA (AC-14 staleness compare)
  generated_at: z.string().nullable(), // ISO timestamp
});
export type OnboardingDoc = z.infer<typeof OnboardingDoc>;
```
Note: NO cost field on this response contract — cost is server-only (AC-15). (Editing this server-vendored copy also covers `reviewer-core` per root insights; the client copy is mirrored separately in step 4.)

**Modify `server/src/db/schema/context.ts`** — extend the existing `onboarding` table (do not recreate):
```ts
export const onboarding = pgTable('onboarding', {
  repoId: uuid('repo_id').primaryKey().references(() => repos.id, { onDelete: 'cascade' }),
  json: jsonb('json').notNull(),
  generatedAt: timestamp('generated_at', { withTimezone: true }).defaultNow().notNull(),
  sourceSha: text('source_sha'),      // NEW — nullable, index SHA at generation time (AC-11/AC-14)
  costCents: integer('cost_cents'),   // NEW — nullable, integer cents (AC-11); deliberately cents, NOT cost_usd double (spec §Observability — do not "fix" to match agent_runs)
});
```
`text`/`integer` are already imported in this file. Then generate the migration (see §2).

### Step 2 files — repo-intel repo-wide endpoints accessor (`server/`)

**Modify `server/src/modules/repo-intel/types.ts`** — add one method to the `RepoIntel` interface (in the T3 reads block, next to `getCriticalPaths`):
```ts
/** Repo-wide extracted endpoints ("METHOD /path"), deduped. `[]` when off/degraded/no-data (onboarding Routes & APIs — AC-4). */
getRepoEndpoints(repoId: string): Promise<string[]>;
```

**Modify `server/src/modules/repo-intel/repository.ts`** — add a repo-wide read over `file_facts` (the existing `getFileFacts(repoId, files)` is file-scoped; add an unfiltered sibling):
```ts
/** All persisted per-file facts for the repo (onboarding repo-wide routes). */
async getAllFileFacts(repoId: string): Promise<{ endpoints: string[]; crons: string[] }[]> { … eq(t.fileFacts.repoId, repoId) … }
```

**Modify `server/src/modules/repo-intel/service.ts`** — implement `getRepoEndpoints` on `RepoIntelService` (mirror the degraded gate used by `getTopFilesByRank`/`getRepoMap`):
```ts
async getRepoEndpoints(repoId: string): Promise<string[]> {
  if (!this.container.config.repoIntelEnabled) return [];
  const facts = await this.repo.getAllFileFacts(repoId);
  const set = new Set<string>();
  for (const f of facts) for (const e of f.endpoints) set.add(e);
  return [...set];
}
```
(`crons` may be folded into the same flat list or dropped — endpoints are the AC-4 requirement; keep it endpoints-only unless the prompt's routes_and_apis facts read better with crons appended. Planner leaves this micro-choice to the Implementer; either is AC-4-compliant.)

### Step 3 files — the onboarding server module (`server/`)

New folder `server/src/modules/onboarding/`:

- **`constants.ts`** — the fixed section spec + manifest allowlist:
  - `ONBOARDING_SECTIONS: { kind: string; title: string; diagramAllowed: boolean }[]` in fixed order: `tech_stack` (Tech Stack), `architecture` (Architecture, diagram), `routes_and_apis` (Routes & APIs, diagram), `reading_path` (Reading Path), `first_tasks` (First Tasks). This is the source of truth for AC-8 (only architecture/routes_and_apis allow a diagram) and for the `{{sections}}` prompt render.
  - `MANIFEST_FILE_CANDIDATES: string[]` mirroring conventions' `CONFIG_FILE_CANDIDATES` — `['package.json', 'README.md', 'README', 'readme.md', 'docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml', '.env.example', '.env.sample']`. Read in listed order; first existing variant per logical file wins (AC-1, decision C).
  - `MAX_MANIFEST_LINES = 200` (mirror `MAX_CONFIG_LINES`) — bounds each manifest read (edge case: oversized `package.json`/`README`).
  - Local `readFileIfExists(path, maxLines)` + `truncate(content, maxLines)` helpers copied from the conventions module (NOT imported cross-module — onion: don't reach into another module's folder).

- **`repository.ts`** — `OnboardingRepository`, thin Drizzle wrapper over the `onboarding` table:
  - `get(repoId): Promise<{ json: Onboarding; sourceSha: string | null; generatedAt: Date } | null>`
  - `upsert(repoId, { json, sourceSha, costCents }): Promise<void>` — `onConflictDoUpdate` on `repoId` (AC-12, single row; last-write-wins).
  - `toDoc(row | null): OnboardingDoc` mapper (row → `{ onboarding, source_sha, generated_at }`; null → `{ onboarding: null, source_sha: null, generated_at: null }`).
  - NO business logic here (onion repository rule).

- **`service.ts`** — `OnboardingService`, the orchestration (application layer). Constructor `(container: Container)`, `new OnboardingRepository(container.db)` inside (mirrors `ConventionsService`). Methods:
  - `get(repoId): Promise<OnboardingDoc>` — read + map (AC-17: returns the null-doc, never 404).
  - `generate(workspaceId, repoId, log?): Promise<OnboardingDoc>` — the full pipeline (AC-6 … AC-13), described in §Workflow below. Optional `log?: Logger` (pino-shaped `info/warn/error(obj, msg?)`), passed from the route as `req.log`, for AC-11/Observability logging (tokens in/out, cost cents, source_sha, success/failure+reason). Follow the `logger?` param pattern (server insights).

  **`generate` pipeline (one structured LLM call, AC-6):**
  1. Load repo row (`clonePath`, `defaultBranch`). If `!clonePath` → throw "Repository is not cloned yet" (mirror conventions; the route maps to a 4xx). 
  2. `const state = await container.repoIntel.getIndexState(repoId)` → capture `state.lastIndexedSha` (persisted for AC-11) and `degraded = state.degraded === true` (or repo-intel globally off).
  3. **Fact gathering (deterministic):**
     - Tech Stack facts: read `MANIFEST_FILE_CANDIDATES` from `clonePath` via `readFileIfExists` (AC-1; never a tree walk).
     - Architecture facts: `getRepoMap(repoId)` → `.text` (AC-2).
     - Reading Path facts: `getTopFilesByRank(repoId, N)` + `getCriticalPaths(repoId)` — rank-ordered, no churn/hotness (AC-3). Empty edge set → `getCriticalPaths` returns `[]` (edge case handled).
     - Routes & APIs facts: `getRepoEndpoints(repoId)` (AC-4, decision A).
     - Wrap EVERY raw-text fact (manifest bodies, repo-map text, endpoint list) in `wrapUntrusted(...)` before assembly (Untrusted-inputs mitigation; the prompt already treats `<untrusted>` as data).
  4. Assemble ONE `completeStructured` request:
     - `system`: `renderPrompt('onboarding.system.md', { sections: <ordered titled list from ONBOARDING_SECTIONS>, language: 'English' })`.
     - `user`: the wrapped facts, grouped under clear section-fact headings.
     - `schema: Onboarding` (from `@devdigest/shared`), `schemaName: 'onboarding'`, `model`/`provider` from `resolveFeatureModel(container, workspaceId, 'onboarding')`, low `temperature`.
     - Exactly one call — no per-section calls, no embeddings (AC-6/AC-7).
  5. **On LLM error or schema-invalid output (after the adapter's own retries):** do NOT touch the persisted row; rethrow with a reason (AC-10). The route surfaces the failure; any prior doc stays intact.
  6. **Post-process the returned `Onboarding` (deterministic backstops):**
     - Coerce to exactly the 5 `ONBOARDING_SECTIONS` in fixed order (match by `kind`; if the model reordered/renamed, re-map by position/kind and use the canonical `title`).
     - Null the `diagram` on `tech_stack`/`reading_path`/`first_tasks`; keep it only on `architecture`/`routes_and_apis` (AC-8).
     - Drop any `links[].path` not present in that generation's gathered facts (manifest filenames, repo-map paths, ranked-file paths, critical-path files) (AC-9).
     - **Degraded backstop (AC-5):** if `degraded`, overwrite the `architecture`, `routes_and_apis`, and `reading_path` sections with an explicit empty/degraded body (fixed marker string, null diagram, empty links) — do NOT let LLM prose stand for sections whose facts were empty. Tech Stack (manifest) and First Tasks still come from the call.
  7. Compute `costCents = result.costUsd == null ? null : Math.round(result.costUsd * 100)` (AC-11). Log `{ tokensIn, tokensOut, costCents, sourceSha: state.lastIndexedSha, ok: true }` via `log`.
  8. `repo.upsert(repoId, { json: processed, sourceSha: state.lastIndexedSha, costCents })` (AC-11/AC-12/AC-13 — no reindex triggered; only reads the persisted index).
  9. Return `toDoc(...)` of the freshly written row.

- **`routes.ts`** — default Fastify plugin, `withTypeProvider<ZodTypeProvider>()`, mirrors the conventions triad. Two routes (spec Contracts):
  - `GET /repos/:id/onboarding` → `{ params: IdParams, response: { 200: OnboardingDoc } }` → `service.get(req.params.id)` (AC-17/AC-18: always 200 with a possibly-null doc, never 404).
  - `POST /repos/:id/onboarding/generate` → `{ params: IdParams, response: { 200: OnboardingDoc } }` → `service.generate(workspaceId, req.params.id, req.log)` (AC-6/AC-13; Generate and Regenerate are the same endpoint — the client shows "Generate" vs "Regenerate" based on whether a doc exists, AC-20). On the service's "not cloned"/generation error, let it propagate to Fastify's error handler (4xx/5xx with the reason — AC-10).
  - Rate-limit config object optional (inert under `NODE_ENV=test` per server insights); not required by any AC.

- **Register in `server/src/modules/index.ts`** — one import + one entry `onboarding` in the `modules` map (static registration).

- **Tests (flat under `server/test/`, per repo convention — NOT colocated):**
  - `server/test/onboarding.test.ts` (hermetic unit): section post-processing (AC-8 diagram nulling, AC-9 link drop, AC-5 degraded overwrite, exactly-5-sections order), manifest allowlist behavior (AC-1, first-variant-wins, truncation), cost-cents conversion (AC-11), single-LLM-call assertion (AC-6/AC-7 — mock the LLM port, assert `completeStructured` called once). Mock the container/facade via cast object literals (server insights) — repo-intel methods, `llm`, and a stub repository.
  - `server/test/onboarding.it.test.ts` (real Postgres, `.it.test.ts` suffix): AC-5 degraded end-to-end, AC-10 error leaves prior doc intact, AC-12 single-row overwrite, AC-13 generate reads current index without reindex. (Note: `.it.test.ts` cannot run in this sandbox — verify by close reading + the hermetic suite, per server insights.)

### Step 4 files — client contract mirror + hook (`client/`)

- **Modify `client/src/vendor/shared/contracts/knowledge.ts`** — hand-mirror the `OnboardingDoc` addition from step 1 (client vendored copy is a separate physical file; keep byte-identical to server).
- **Modify `client/src/lib/types.ts`** — re-export `OnboardingDoc` (+ `Onboarding`, `OnboardingSection`, `OnboardingLink` if not already) from the shared hub (client convention: import types from `lib/types`, not the vendored path).
- **New `client/src/lib/hooks/onboarding.ts`** — TanStack Query hooks over `lib/api`:
  - `useOnboarding(repoId)` → `useQuery(["onboarding", repoId], GET /repos/:id/onboarding)` returning `OnboardingDoc`.
  - `useGenerateOnboarding(repoId)` → `useMutation(POST /repos/:id/onboarding/generate)`, `onSuccess` invalidates `["onboarding", repoId]`. Serves both Generate and Regenerate (AC-20).
- **Modify `client/src/lib/hooks/index.ts`** — add `export * from "./onboarding";` (barrel is not auto-populated — client insight).

### Step 5 files — client tour screen (`client/`)

- **New `client/src/app/repos/[repoId]/onboarding/page.tsx`** — `"use client"`, mirrors `context/page.tsx`: `useParams`, `useActiveRepo`, `useRepoNotFound`, wrap in `AppShell` with a repo crumb + `t("title")`, render `<OnboardingPage repoId={repoId} />`. This is the stable bookmarkable `:repoId`-scoped URL (AC-18); it lives inside the existing authenticated shell (no new public route).
- **New `client/src/app/repos/[repoId]/onboarding/_components/OnboardingPage/`** (co-located: `OnboardingPage.tsx`, `styles.ts`, `constants.ts`, `helpers.ts`, `index.ts`; sub-components under `_components/`):
  - Loads `useOnboarding(repoId)` + `useRepoIntelStatus(repoId)`.
  - **Empty state (AC-17/AC-20):** if `doc.onboarding == null` → `EmptyState` + a **Generate** CTA calling `useGenerateOnboarding` (reuse `t("generate.*")`).
  - **Loaded state (AC-16):** render the 5 sections in `doc.onboarding.sections` order; each `body` via `Markdown`, each non-null `diagram` via `MermaidDiagram` (accessible fallback already provided by that component). Section splitting per `ui-architecture` (a `Section` sub-component if the page exceeds ~200 lines).
  - **Staleness (AC-14):** compare `doc.source_sha` vs `useRepoIntelStatus(repoId).data.lastIndexedSha`; when they differ, show a stale indicator inviting Regenerate. Reuse the existing index-state hook — no new endpoint.
  - **Regenerate (AC-20):** shown whenever `doc.onboarding != null`; calls the same generate mutation.
  - **Copy link (AC-19):** a button copying the current stable URL (`window.location.href`) via `navigator.clipboard`; accessible label via `t(...)`. Pair any `setTimeout` "copied!" feedback with `clearTimeout` cleanup (client insight).
  - **No cost anywhere in the UI (AC-15)** — the response contract carries no cost field, so this is structurally guaranteed; do not add one.
  - All strings via `useTranslations("onboarding")` (client i18n rule).
  - `page.test.tsx` (RTL, mocks `fetch`/hooks per the static-import + `mockReturnValue` pattern from client insights): empty state renders Generate (AC-17), loaded state renders 5 sections + a mermaid section, stale indicator toggles on SHA mismatch (AC-14), no cost string in output (AC-15).
- **Modify `client/src/vendor/ui/nav.ts`** — add one `NavItem` to the repo-scoped `NAV` group: `{ key: "onboarding-tour", label: "Onboarding Tour", icon: <choose existing, e.g. "Compass"/"Map"/"BookOpen">, href: "/repos/:repoId/onboarding" }`. `activeKeyFor` already returns `"onboarding-tour"` for this path — key MUST match. (nav.ts is first-party route config, hand-edited in place like vendored shared — client insight.)
- **Modify `client/messages/en/onboarding.json`** — add keys not already present: stale-indicator text + regenerate-invite, copy-link label + copied-confirmation, the five section titles (or rely on server-provided `title`), and any empty-state/error additions. Keep existing keys.

---

## 2. Dependency changes

- **DB migration (step 1):** after editing `server/src/db/schema/context.ts`, run `cd server && pnpm db:generate` then `pnpm db:migrate`. Never hand-edit `src/db/migrations/*`. Expect one migration adding `onboarding.source_sha` (text, null) + `onboarding.cost_cents` (integer, null). If `db:generate` proposes anything about `agent_runs.cost_usd` or other unrelated columns, that's the known stale-snapshot bug (server insights) — isolate by temporarily moving the schema edit out, regenerate to confirm, do NOT add a catch-up migration for a phantom column.
- **Vendored `@devdigest/shared`:** the `OnboardingDoc` contract must be added to BOTH `server/src/vendor/shared/contracts/knowledge.ts` (step 1 — also covers reviewer-core) AND `client/src/vendor/shared/contracts/knowledge.ts` (step 4), kept byte-identical by hand.
- **New packages:** none (client reuses `Markdown`/`MermaidDiagram`; no chart/markdown dependency added).
- **Env vars:** none. No new secrets, write scope, or outbound calls (spec §Untrusted inputs).
- **Feature model / prompt:** none — `'onboarding'` `FeatureModelId` and `onboarding.system.md` already exist.

---

## 3. Execution order (disjoint file ownership — no file appears in two steps)

**Step 1 — Shared contract + `onboarding` schema columns + migration.**
- Owns: `server/src/vendor/shared/contracts/knowledge.ts`, `server/src/db/schema/context.ts`, the generated `server/src/db/migrations/<new>.sql` + `server/src/db/migrations/meta/*` (Drizzle output).
- Depends on: nothing.
- Done when: `cd server && pnpm typecheck` clean; `pnpm db:generate` produces exactly the 2-column migration; `pnpm db:migrate` applies it.

**Step 2 — repo-intel `getRepoEndpoints` facade method.** *(independent of step 1)*
- Owns: `server/src/modules/repo-intel/types.ts`, `server/src/modules/repo-intel/service.ts`, `server/src/modules/repo-intel/repository.ts`.
- Depends on: nothing.
- Done when: `cd server && pnpm typecheck` clean; a hermetic unit assertion (in the existing repo-intel facade tests or the step-3 unit file) confirms `getRepoEndpoints` returns `[]` when `repoIntelEnabled` is false and a deduped union otherwise.

**Step 3 — onboarding server module + registration + tests.**
- Owns: `server/src/modules/onboarding/{constants,repository,service,routes}.ts`, `server/src/modules/index.ts`, `server/test/onboarding.test.ts`, `server/test/onboarding.it.test.ts`.
- Depends on: step 1 (schema + `OnboardingDoc`), step 2 (`getRepoEndpoints`).
- Done when: `cd server && pnpm typecheck` clean; `pnpm exec vitest run --exclude '**/*.it.test.ts'` passes including the new unit file (AC-1/AC-3/AC-5/AC-6/AC-7/AC-8/AC-9/AC-11/AC-12); `.it.test.ts` written + typechecked (cannot execute in sandbox).

**Step 4 — client contract mirror + hook.**
- Owns: `client/src/vendor/shared/contracts/knowledge.ts`, `client/src/lib/types.ts`, `client/src/lib/hooks/onboarding.ts`, `client/src/lib/hooks/index.ts`.
- Depends on: step 1 (contract shape to mirror); runtime needs step 3's routes.
- Done when: `cd client && pnpm typecheck` clean; client copy byte-identical to server's `OnboardingDoc`.

**Step 5 — client tour screen + nav + i18n.**
- Owns: `client/src/app/repos/[repoId]/onboarding/**` (page + `_components/**` + `page.test.tsx`), `client/src/vendor/ui/nav.ts`, `client/messages/en/onboarding.json`.
- Depends on: step 4 (hook + types).
- Done when: `cd client && pnpm typecheck` clean; `pnpm test` passes including `page.test.tsx` (AC-14/AC-15/AC-16/AC-17/AC-19/AC-20); nav item's `key` is `"onboarding-tour"` (matches `activeKeyFor`).

---

## 4. Definition of Done (whole feature)

- `cd server && pnpm typecheck` and `cd client && pnpm typecheck` both clean.
- `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'` green (onboarding unit + repo-intel).
- `server/test/onboarding.it.test.ts` written and typechecked against the real schema (execution blocked in this sandbox — note in the summary, per server insights).
- `cd client && pnpm test` green (onboarding `page.test.tsx`).
- `cd server && pnpm db:generate` reports zero further drift after the step-1 migration.
- Manual verification (dev stack): import/index a repo → open `/repos/:repoId/onboarding` → empty state + Generate (AC-17) → generate → 5 sections in fixed order with a rendered mermaid diagram (AC-16) → advance the index (`POST /repos/:id/resync`) → stale indicator appears (AC-14) → Regenerate refreshes (AC-13, AC-20) → Copy link copies the URL (AC-19) → server logs show tokens/cost-cents/source_sha, and no cost figure anywhere on screen (AC-11/AC-15).
- Edge cases exercised: repo-intel disabled → Tech Stack still generates, other three sections degraded-empty (AC-5); empty edge graph → Reading Path empty; LLM failure → prior doc untouched + error surfaced (AC-10); hallucinated link path dropped (AC-9); GET for never-generated repo returns null doc, not 404 (AC-17).

## 5. Risks and assumptions

- **Regenerate concurrency (decision B):** no locking; two concurrent Regenerates last-write-wins on the single `onboarding` row (AC-12 model). Acceptable per spec; if a stricter "reject second in-flight" guarantee is later required it needs a new advisory-lock/status mechanism (out of scope).
- **Facade interface change (decision A):** adding `getRepoEndpoints` to `RepoIntel` — one real implementor (`RepoIntelService`); test mocks are cast object literals, so only tests that call it need the method. Low blast radius, but the Implementer must add the method to `RepoIntelService` in the SAME step (step 2) or `pnpm typecheck` fails at the interface.
- **Endpoint extraction coverage:** `file_facts.endpoints` is populated by the Fastify/Express-shaped extractor; decorator-routed frameworks (NestJS) yield empty endpoints (server insights). For such repos, Routes & APIs will be sparse — acceptable (degrades to a thin section, not an error). Not this feature's problem to fix.
- **`getRepoMap` cache miss:** `getRepoMap` only hits at `DEFAULT_REPO_MAP_TOKEN_BUDGET`; an unindexed/partial repo returns degraded empty text — handled by the AC-5 degraded backstop.
- **Cost null:** non-OpenRouter providers may return `costUsd: null`; `costCents` stored as null then. `'onboarding'` defaults to OpenRouter, so this is the exception, not the norm.
- **`.it.test.ts` unrunnable in sandbox** (testcontainers limitation, server insights) — integration coverage is verified by close reading + the hermetic suite; flag in the summary.
- **Assumption:** the existing `onboarding.system.md` prompt's `{{sections}}`/`{{language}}` placeholders and diagram/no-fabrication rules are correct as-is (spec confirms). If the model routinely returns a diagram on a disallowed section, the AC-8 code backstop nulls it — the prompt is not modified.
