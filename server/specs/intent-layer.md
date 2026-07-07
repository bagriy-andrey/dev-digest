# Spec: Intent Layer

**Status:** planning
**Scope:** `server/`, `reviewer-core/`, `client/` (one combined spec, owned by `server/`,
mirroring the cross-cutting `server/specs/skills.md` convention).

A cheap flash-class LLM call (via OpenRouter) classifies **why** a PR was opened before
review, producing `Intent { intent, in_scope[], out_of_scope[] }`. The intent is stored
per-PR, recomputed only via a manual "Recalculate" button, injected into the main review
agent's prompt (with a scope-policy rule), and shown as an "Intent card" on the PR page
before findings. The classifier model is configurable: workspace default (existing Settings →
Models picker) with a new per-repository override.

---

## 0. What already exists (do not recreate)

| Artifact | State | Location (file:line) |
|---|---|---|
| `pr_intent` table (`pr_id` PK, `intent` text, `in_scope`/`out_of_scope` jsonb) | ✅ exists | `server/src/db/schema/reviews.ts:48-55` |
| `Intent` zod contract `{intent, in_scope[], out_of_scope[]}` | ✅ exists (both vendored copies) | `server/src/vendor/shared/contracts/brief.ts:8-13` |
| `FeatureModelId` enum incl. `'review_intent'` | ✅ exists | `.../contracts/platform.ts:14-20` |
| `FEATURE_MODELS` registry incl. `review_intent` entry | ⚠️ exists but default is `openai/gpt-4.1` (NOT flash) | `.../contracts/platform.ts:52-57` |
| `Settings.feature_models` per-feature override (workspace-scoped only) | ✅ exists | `.../contracts/platform.ts:94` |
| `getIntent` / `upsertIntent` (unused; zero call sites) | ✅ exists | `server/src/modules/reviews/repository/pull.repo.ts:49-68`, facade `repository.ts:130-136` |
| `resolveFeatureModel(container, workspaceId, id)` (workspace→registry) | ✅ exists | `server/src/modules/settings/feature-models.ts:51-57` |
| Linked-issue resolution end-to-end (`closes/fixes/resolves #N` → `IssueMeta`) | ✅ exists (real adapter) | `server/src/adapters/github/octokit.ts:70-135`; contract `platform.ts:212-224` |
| `INJECTION_GUARD` already names "derived intent/scope" as untrusted | ✅ exists | `reviewer-core/src/prompt.ts:16-28` |
| Optional prompt slots pattern (`skills`/`specs`/`callers`/`repoMap`/`prDescription`) | ✅ exists | `reviewer-core/src/prompt.ts:39-141`, `src/review/run.ts:44-142` |
| Global Settings → Models picker (generic over `FEATURE_MODELS`) | ✅ exists, already shows `review_intent` | `client/src/app/settings/[section]/_components/SettingsView/_components/SettingsModels/SettingsModels.tsx` |
| `OverviewTab` (rendered on the PR page before `findings`) | ✅ exists (takes only `prBody`) | `client/src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/OverviewTab.tsx` |
| `ConventionsService.extract()` — the exact classifier pattern to mirror | ✅ reference | `server/src/modules/conventions/service.ts:74-182` |

**What is MISSING (the real net-new work):** flash default for `review_intent`; per-repo
override schema + resolver + UI; the classifier module (service/routes/helpers); recalculate +
read routes; the `reviewer-core` `intent` prompt slot; the client Intent card + hooks; wiring
the stored intent into `run-executor`.

### Gotchas baked in from insights (read once, apply throughout)

- **`@devdigest/shared` is vendored twice, NOT three times.** `reviewer-core/tsconfig.json:22-23`
  aliases `@devdigest/shared` to **the server's** `server/src/vendor/shared`. So editing a
  contract in `server/src/vendor/shared/**` covers **server + reviewer-core**; only the
  **client** copy (`client/src/vendor/shared/**`) must be hand-mirrored.
- **The client UI reads model defaults from `client/src/lib/feature-models.ts`, NOT the vendored
  copy.** The vendored `client/src/vendor/shared/contracts/platform.ts` `FEATURE_MODELS` value is
  unused by the webpack bundle (comment in `lib/feature-models.ts` explains why). So the
  user-visible default change MUST edit `lib/feature-models.ts`; edit the vendored copy too only
  for type/source-of-truth parity. (Note: these two client files have already drifted for the
  `conventions` entry — do NOT "fix" that drift here; touch only the `review_intent` entry.)
- **`tsx watch` does not hot-reload `vendor/shared/**`.** `DEFAULTS` in `feature-models.ts` is
  computed at module load. After changing the `review_intent` default, the server must be
  killed and restarted for it to take effect (`server/insights.md`).
- **`PromptAssembly` lives inside the `run_traces.trace` jsonb document**, which has no response
  Zod schema and no migration of historical rows. A NEW field on it MUST be `.nullish()`, never
  `.nullable()` (`server/insights.md`, per-run-cost lesson).
- **Mock GitHub adapter hardcodes `linked_issue: null`** (`server/src/adapters/mocks.ts:183`).
  The classifier's linked-issue path is therefore untestable against the mock/dev adapter — the
  classifier MUST degrade gracefully (issue omitted) and this is called out in the DoD.
- **`agent_runs` write signatures are declared twice** (impl `run.repo.ts` + facade
  `repository.ts`) — irrelevant here because the classifier does NOT create an `agent_run`
  (see §1.3 decision on observability), but noted so no one adds one by reflex.

---

## 1. Module breakdown (dependency order: reviewer-core → server → client)

### 1.A `reviewer-core/` — new optional `intent` prompt slot

**Modify `reviewer-core/src/prompt.ts`:**
- Add to `PromptParts` (after `prDescription?`):
  ```ts
  /**
   * Derived PR intent/scope (untrusted — classifier output over attacker-controlled
   * PR text). Rendered as `## Intent`: a short TRUSTED scope-policy sentence OUTSIDE the
   * wrapper, then the summary/in-scope/out-of-scope content INSIDE `wrapUntrusted`.
   * Empty/undefined → section omitted (same contract as the other optional slots).
   */
  intent?: { summary: string; inScope: string[]; outOfScope: string[] };
  ```
- In `assemblePrompt`, build `intentBlock` (the untrusted rendered text) when
  `parts.intent` is present and `summary.trim()` is non-empty, e.g.:
  ```
  Summary: <summary>
  In scope:
  - <inScope[i]>            (line omitted when array empty)
  Out of scope:
  - <outOfScope[i]>         (line omitted when array empty)
  ```
- Push the section **right after `## PR description` (current line 108) and before
  `## Skills / rules` (current line 109)**:
  ```ts
  if (intentBlock) {
    userSections.push(
      `## Intent\n` +
      `Scope policy: focus your review on changes that serve this PR's stated intent. ` +
      `Do NOT raise findings about matters the author placed out of scope; if you spot a ` +
      `SERIOUS defect that is out of scope, surface it as exactly ONE flagged signal, not ` +
      `multiple findings.\n` +
      wrapUntrusted('intent', intentBlock),
    );
  }
  ```
  The scope-policy sentence is a **trusted system instruction → OUTSIDE** the wrapper; the
  classifier-derived text is **untrusted → INSIDE** `wrapUntrusted`. (This is the exact split
  `reviewer-core/insights.md` prescribes, and the `INJECTION_GUARD` at lines 16-28 already lists
  "derived intent/scope" as untrusted, so no guard change is needed.)
- Extend `AssembledPrompt.assembly`: add `intent: intentBlock ?? null` (mirrors
  `pr_description: prDescription ?? null`).

**Modify `reviewer-core/src/review/run.ts`:**
- Add `intent?: { summary: string; inScope: string[]; outOfScope: string[] }` to `ReviewInput`
  (after `prDescription?`, line ~73), same doc-comment contract.
- Add `intent: input.intent,` to the `promptParts` object (line ~130-139) so BOTH the
  single-pass and map-reduce assembly calls receive it (both spread `...promptParts`).

`reviewer-core/src/index.ts` already re-exports `PromptParts` / `ReviewInput` via type — no
export change needed. `reviewer-core` has NO other change (still pure; still typecheck-only build).

### 1.B `server/` — contracts, schema, resolver, classifier module, routes, run-executor wiring

**Modify `server/src/vendor/shared/contracts/platform.ts`:**
- Change the `review_intent` entry in `FEATURE_MODELS` (lines 52-57) from
  `{ defaultProvider: 'openai', defaultModel: 'gpt-4.1' }` to a **flash-class OpenRouter**
  default: `{ defaultProvider: 'openrouter', defaultModel: 'google/gemini-2.5-flash' }`.
  (Rationale: cheap/flash, current, function-calling capable for structured output, on
  OpenRouter — the mandated provider. This mirrors the `onboarding`/`conventions` entries which
  already default to `openrouter` flash models. If the team prefers a different flash SKU, this
  one constant is the only place to change it.)
- Add two small contracts for the per-repo override endpoints (used by the new routes and the
  client hook):
  ```ts
  /** A repo-scoped feature-model override row (GET response / POST body). */
  export const RepoFeatureModel = z.object({
    feature: FeatureModelId,
    provider: Provider,
    model: z.string().min(1),
  });
  export type RepoFeatureModel = z.infer<typeof RepoFeatureModel>;
  ```
  (Zod: reuse the existing `FeatureModelId` enum + `Provider`; `model` gets `.min(1)` at the
  boundary — `schema-string-validations`. No `z.any`.)

**Create `server/src/db/schema/repo-settings.ts`:**
```ts
import { pgTable, uuid, text, primaryKey } from 'drizzle-orm/pg-core';
import { repos } from './repos';

/**
 * Per-repository overrides for a system LLM feature's model. Resolution order is
 * repo override → workspace Settings override → FEATURE_MODELS registry default.
 * Generic over feature_id (TEXT = FeatureModelId) so future features reuse it; the
 * Intent Layer is the first consumer (feature_id = 'review_intent').
 */
export const repoFeatureModels = pgTable(
  'repo_feature_models',
  {
    repoId: uuid('repo_id').notNull().references(() => repos.id, { onDelete: 'cascade' }),
    featureId: text('feature_id').notNull(),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.repoId, t.featureId] }) }),
);
```
Design justification (per `postgresql-table-design` + `server/insights.md`): a **dedicated table
with explicit typed columns**, chosen over adding a nullable `repo_id` to the `settings` table.
The settings route (`PUT /settings`) is a generic key/value bag with a unique index on
`(workspace_id, user_id, key)`; injecting a nullable `repo_id` forces a `NULLS NOT DISTINCT`
(PG15+) index to preserve workspace-row uniqueness AND threads `repo_id` through the whole
`rowsToSettings` / PUT machinery — larger blast radius on a hot table. The dedicated table
isolates the new concept, needs no change to existing settings behavior, and the composite PK
`(repo_id, feature_id)` gives natural upsert semantics. FK `repo_id` is covered by the PK's
leading column (no extra FK index needed for the `repoId` access path).

**Modify `server/src/db/schema.ts` (barrel):** add `export * from './schema/repo-settings';`
in the `export *` block, import `repoFeatureModels`, and add it to the `schema` object.

**Modify `server/src/modules/settings/feature-models.ts`:** add a repo-aware resolver WITHOUT
touching the existing workspace-only `resolveFeatureModel` (keep it for other callers):
```ts
export async function resolveFeatureModelForRepo(
  container: Container,
  workspaceId: string,
  repoId: string,
  id: FeatureModelId,
): Promise<FeatureModelChoice> {
  // 1. repo override (validated) — workspace ownership of the repo is enforced by the caller.
  const [row] = await container.db
    .select({ provider: t.repoFeatureModels.provider, model: t.repoFeatureModels.model })
    .from(t.repoFeatureModels)
    .where(and(eq(t.repoFeatureModels.repoId, repoId), eq(t.repoFeatureModels.featureId, id)));
  const repoChoice = FeatureModelChoice.safeParse(row);
  if (repoChoice.success) return repoChoice.data;
  // 2. workspace override, else 3. registry default.
  return resolveFeatureModel(container, workspaceId, id);
}
```
Plus a tiny read helper `getRepoFeatureModel(container, repoId, id)` returning the row (or
undefined) for the GET endpoint, and an upsert helper `setRepoFeatureModel(...)` used by POST
(`onConflictDoUpdate` target `[repoId, featureId]`).

**Create `server/src/modules/intent/` (new feature module — onion: routes → service → helpers):**

`server/src/modules/intent/helpers.ts` (pure domain — unit-testable, no I/O):
- `extractHunkHeaders(patch: string | null): string[]` — return the `@@ … @@` lines from a
  unified-diff patch (the token-saving projection; NO diff bodies).
- `buildClassifierInput(args): { messages, metrics }` — assemble the user message from:
  title, **untruncated** body (capped only at a generous `MAX_INTENT_BODY_CHARS = 16_000` — a
  separate, larger cap than the review's 4000, per decision #6, so embedded plans / plan links
  in the body survive), linked-issue `title/body/state` when present, and per-file
  `path + hunk headers only`. Also compute `metrics` (token-savings; see §1.3).
- `INTENT_SYSTEM_PROMPT` — instructs the classifier to treat all PR text as DATA, infer the
  PR's purpose, and return best-effort scope even when there is NO spec/issue (decision #5).

`server/src/modules/intent/service.ts` — `IntentService` (mirrors `ConventionsService`):
- Constructed `new IntentService(container)`; instantiates `new ReviewRepository(container.db)`
  for `getPull` / `getPrFiles` / `getIntent` / `upsertIntent` (existing facade methods — the
  established "service news up its repo with `container.db`" pattern, `server/insights.md`).
- `get(workspaceId, prId): Promise<Intent | null>` → `repo.getIntent(prId)` (workspace-scoped
  via `repo.getPull` existence check first → 404 if PR not in workspace).
- `recalculate(workspaceId, prId, logger): Promise<{ intent: Intent; metrics: TokenMetrics }>`:
  1. `pull = repo.getPull(workspaceId, prId)` → `NotFoundError` if absent (A01 ownership check).
  2. `repoRow = repo.getRepo(pull.repoId)`.
  3. `files = repo.getPrFiles(prId)` → project each to `path + extractHunkHeaders(patch)`.
  4. Best-effort linked issue: `try { gh = await container.github(); detail = await
     gh.getPullRequest({owner,name}, pull.number); linkedIssue = detail.linked_issue } catch {
     linkedIssue = undefined }`. Also refresh `body` from `detail.body ?? pull.body`. Degrades
     silently offline / on the mock adapter (issue omitted) — NOT an error.
  5. `{ provider, model } = resolveFeatureModelForRepo(container, workspaceId, pull.repoId,
     'review_intent')`.
  6. `llm = await container.llm(provider)`; `llm.completeStructured({ model, schema: Intent,
     schemaName: 'pr_intent', temperature: 0.1, messages })` (same call shape as
     `ConventionsService.extract`; `Intent` is the shared contract used directly as the
     structured-output schema).
  7. `Intent.safeParse` the result (defense-in-depth over the provider's structured mode),
     `repo.upsertIntent(prId, intent)`.
  8. Log `metrics` (§1.3) and return `{ intent, metrics }`.

`server/src/modules/intent/routes.ts` — Fastify plugin (`fastify-type-provider-zod`):
```
GET  /pulls/:id/intent                 → Intent | null                       (read stored)
POST /pulls/:id/intent/recalculate     → Intent   (rateLimit 10/min)         (manual trigger)
GET  /repos/:id/intent-model           → RepoFeatureModel | null             (repo override read)
PUT  /repos/:id/intent-model           → RepoFeatureModel  (body: {provider, model})
```
- Reuse `getContext(container, req)` for `workspaceId`; reuse `IdParams`.
- The two `/repos/:id/...` endpoints MUST verify the repo belongs to the workspace before
  read/write (A01 — join `repos` on `workspace_id`, else `NotFoundError`). `featureId` is fixed
  to `'review_intent'` server-side (not taken from the client) so this endpoint can't be used to
  write arbitrary feature rows.
- `POST /pulls/:id/intent/recalculate` gets `config: { rateLimit: { max: 10, timeWindow: '1
  minute' } }` (A06 — mirrors `/pulls/:id/review`; the call fans out to a paid LLM).
- Response schemas declared with Zod (`response: { 200: ... }`) so serialization matches.

**Modify `server/src/modules/index.ts`:** one import + one registry entry `intent`.

**Modify `server/src/modules/reviews/run-executor.ts` (`runOneAgent`):** READ-ONLY wire-in — the
classifier is NEVER auto-run here (decision: recompute only via the button). Before the
`reviewPullRequest({...})` call, fetch the stored intent and pass it when present:
```ts
const storedIntent = await this.repo.getIntent(pull.id); // undefined when never classified
if (storedIntent) runLog.info('Intent: injecting stored PR intent/scope into the review prompt');
else runLog.info('Intent: none stored for this PR — review runs without an intent section');
// …inside reviewPullRequest({ … }):
...(storedIntent
  ? { intent: {
        summary: storedIntent.intent,
        inScope: storedIntent.in_scope,
        outOfScope: storedIntent.out_of_scope,
      } }
  : {}),
```
`prompt_assembly.intent` fills automatically via `outcome.assembly` (reviewer-core §1.A). The
existing comments in this file that mention loading "diff + intent" are now accurate for the
first time; do not add a compute path.

### 1.C Shared contract mirror (client copies)

**Modify `client/src/vendor/shared/contracts/platform.ts`:** change the `review_intent`
`FEATURE_MODELS` default to match server (`openrouter` / `google/gemini-2.5-flash`); add the
`RepoFeatureModel` contract (mirror). Hand-synced per repo convention.

**Modify `client/src/lib/feature-models.ts`:** change the `review_intent` entry default (this is
the copy the UI actually renders). Touch ONLY the `review_intent` entry.

**Modify `server/src/vendor/shared/contracts/trace.ts`:** add `intent: z.string().nullish()` to
`PromptAssembly` (covers server + reviewer-core). **`.nullish()` NOT `.nullable()`** — historical
`run_traces` docs predate this field.

**Modify `client/src/vendor/shared/contracts/trace.ts`:** mirror the `PromptAssembly.intent`
addition so the Run Trace drawer's types don't drift.

### 1.D `client/` — hooks, Intent card, per-repo override UI

**Create `client/src/lib/hooks/intent.ts`** (TanStack Query; all data through `lib/api.ts`):
```ts
usePrIntent(prId)          // GET  /pulls/:id/intent            queryKey ["pr-intent", prId]
useRecalculateIntent(prId) // POST /pulls/:id/intent/recalculate → onSuccess setQueryData(["pr-intent", prId])
useRepoIntentModel(repoId) // GET  /repos/:id/intent-model      queryKey ["repo-intent-model", repoId]
useSetRepoIntentModel(repoId) // PUT /repos/:id/intent-model    → invalidate ["repo-intent-model", repoId]
```
Re-export `Intent` / `RepoFeatureModel` types via `lib/types.ts` per client convention.

**Modify `client/src/lib/hooks/index.ts`:** add `export * from "./intent";`.

**Create `client/src/app/repos/[repoId]/pulls/[number]/_components/IntentCard/`**
(co-location convention: `IntentCard.tsx` + `styles.ts` + `index.ts`):
- Props `{ prId: string | null; repoId: string }`.
- `usePrIntent(prId)` → render Summary, In-scope list, Out-of-scope list. Sort nothing (server
  order is authoritative; arrays are small). Empty/`null` intent → an empty state ("No intent
  computed yet — Recalculate to classify this PR").
- "Recalculate" button → `useRecalculateIntent(prId)` with `isPending` loading state
  (mirror the `useRunExtractor` interaction in the conventions page and `RunReviewDropdown`).
- Model control: show the effective classifier model via `useRepoIntentModel(repoId)` (falls
  back in copy to "workspace default" when null) with a `SearchableSelect`
  (`useProviderModels("openrouter")`) that calls `useSetRepoIntentModel`. This satisfies the
  per-repo override "next to the action" and complements the Settings surface below.
- All strings via `next-intl` (add keys to `client/messages/en/prReview.json`) — no hardcoded
  copy (client `insights.md`: the god-page already has a `window.confirm` i18n violation; do not
  add another).

**Modify `client/src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/OverviewTab.tsx`:**
accept `prId` + `repoId`, render `<IntentCard prId={prId} repoId={repoId} />` ABOVE the existing
Description block (so intent is seen before findings and before the body).

**Modify `client/src/app/repos/[repoId]/pulls/[number]/page.tsx`:** pass the new props —
`<OverviewTab prBody={pr.body} prId={prId} repoId={repoId} />` (one line; `prId` and `repoId`
are already in scope).

**Create `client/src/app/settings/[section]/_components/SettingsView/_components/SettingsRepoModels/`**
(`SettingsRepoModels.tsx` + `styles.ts` + `index.ts`) — the "in Settings" per-repo override
surface required by the feature: a repo selector (`useRepos`, same pattern as
`ConventionsPage`) + a `SearchableSelect` model picker bound to
`useRepoIntentModel`/`useSetRepoIntentModel` for the selected repo, scoped to the
`review_intent` feature. Strings → `client/messages/en/settings.json`.

**Modify `client/src/app/settings/[section]/_components/SettingsView/SettingsView.tsx`:** mount
`<SettingsRepoModels />` inside the existing Models section, below `<SettingsModels />`
(the global picker, unchanged).

---

## 2. Dependency changes

- **New packages:** none. OpenRouter provider, `completeStructured`, `SearchableSelect`,
  `useProviderModels` all already exist.
- **DB migration:** ONE new table `repo_feature_models`. Workflow: edit the schema files
  (§1.B), then `cd server && pnpm db:generate` (creates `server/src/db/migrations/00XX_*.sql`
  + meta) then `pnpm db:migrate`. **Never hand-edit** the generated migration.
- **Env vars:** none new (OpenRouter key already configured via `SecretsProvider`).
- **Vendored `@devdigest/shared`:** `platform.ts` (`review_intent` default + `RepoFeatureModel`)
  and `trace.ts` (`PromptAssembly.intent`) change in BOTH the server copy (also serves
  reviewer-core) and the client copy — hand-synced. Plus the non-vendored client runtime
  registry `client/src/lib/feature-models.ts`.
- **Server restart** required after the `FEATURE_MODELS` change (tsx-watch does not reload
  `vendor/shared`).

---

## 3. Execution order (disjoint file ownership per step → parallel-safe)

Each step lists the EXACT files it owns. No file appears in two steps.

**Step 1 — reviewer-core intent slot** (no deps)
Owns:
- `reviewer-core/src/prompt.ts`
- `reviewer-core/src/review/run.ts`
Test: `cd reviewer-core && npm run typecheck && npm test`. Add/extend a `prompt` unit test —
intent present → `## Intent` section with the trusted policy line OUTSIDE and the summary/scope
INSIDE `<untrusted source="intent">`; intent absent → no section, `assembly.intent === null`.

**Step 2 — shared `PromptAssembly.intent` (both copies)** (no deps; independent of Step 1's code)
Owns:
- `server/src/vendor/shared/contracts/trace.ts`
- `client/src/vendor/shared/contracts/trace.ts`
Test: `cd server && pnpm typecheck`; `cd client && pnpm typecheck`. Field is `.nullish()`.

**Step 3 — `FEATURE_MODELS` flash default + `RepoFeatureModel` contract (all 3 registries)**
(no deps)
Owns:
- `server/src/vendor/shared/contracts/platform.ts`
- `client/src/vendor/shared/contracts/platform.ts`
- `client/src/lib/feature-models.ts`
Test: `cd server && pnpm typecheck`; `cd client && pnpm typecheck`. Grep confirms
`review_intent` default is now `openrouter` in all three; the two client files match for
`review_intent`. Restart server to clear the cached `DEFAULTS`.

**Step 4 — DB table `repo_feature_models` + migration** (no deps)
Owns:
- `server/src/db/schema/repo-settings.ts`
- `server/src/db/schema.ts`
- `server/src/db/migrations/*` (generated by `pnpm db:generate`; do not hand-edit)
Test: `pnpm db:generate` produces exactly one new migration adding `repo_feature_models`;
`pnpm db:migrate` applies clean; `pnpm typecheck`.

**Step 5 — repo-aware resolver** (depends on Step 4 schema)
Owns:
- `server/src/modules/settings/feature-models.ts`
Test: `pnpm typecheck`. A `*.it.test.ts` (real PG) asserting resolution order: repo row →
returned; no repo row but workspace `feature_models` set → workspace; neither → registry
default (`openrouter/google/gemini-2.5-flash`).

**Step 6 — intent classifier module** (depends on Steps 3, 5; reads existing `ReviewRepository`)
Owns:
- `server/src/modules/intent/helpers.ts`
- `server/src/modules/intent/service.ts`
- `server/src/modules/intent/routes.ts`
Test: unit test `extractHunkHeaders` (hermetic) — only `@@` lines returned, `null`/empty patch →
`[]`; unit test the token-savings metric math. `pnpm typecheck`.

**Step 7 — register intent module** (depends on Step 6)
Owns:
- `server/src/modules/index.ts`
Test: server boots; `GET /pulls/:id/intent` returns `null` for an unclassified PR; a
`*.it.test.ts` exercises `POST /pulls/:id/intent/recalculate` end-to-end against a seeded PR
(stub the LLM provider via `ContainerOverrides`/`adapters/mocks.ts`) and asserts `pr_intent` was
upserted and the token-savings log line fired.

**Step 8 — run-executor intent read-in** (depends on Step 1 for the `intent` param shape)
Owns:
- `server/src/modules/reviews/run-executor.ts`
Test: `pnpm typecheck`; extend a reviews `*.it.test.ts` — a PR WITH a stored intent →
`prompt_assembly.intent` non-null in the persisted trace; a PR WITHOUT → `intent` null and the
prompt otherwise unchanged (byte-identical to the pre-intent shape).

**Step 9 — client intent hooks** (depends on Steps 3 read of `RepoFeatureModel` type; API from
Steps 6-7)
Owns:
- `client/src/lib/hooks/intent.ts`
- `client/src/lib/hooks/index.ts`
- `client/src/lib/types.ts` (re-export `Intent` / `RepoFeatureModel`)
Test: `cd client && pnpm typecheck`; a hook test mocking `fetch` (jsdom) for `usePrIntent` +
`useRecalculateIntent` cache update.

**Step 10 — PR-page Intent card** (depends on Step 9 hooks)
Owns:
- `client/src/app/repos/[repoId]/pulls/[number]/_components/IntentCard/IntentCard.tsx`
- `client/src/app/repos/[repoId]/pulls/[number]/_components/IntentCard/styles.ts`
- `client/src/app/repos/[repoId]/pulls/[number]/_components/IntentCard/index.ts`
- `client/src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/OverviewTab.tsx`
- `client/src/app/repos/[repoId]/pulls/[number]/page.tsx`
- `client/messages/en/prReview.json`
Test: `pnpm typecheck` + `pnpm test`; RTL test — renders summary/in/out lists from a mocked
`usePrIntent`; "Recalculate" click triggers the mutation and shows the pending state; empty
intent → empty state.

**Step 11 — Settings per-repo override surface** (depends on Step 9 hooks)
Owns:
- `client/src/app/settings/[section]/_components/SettingsView/_components/SettingsRepoModels/SettingsRepoModels.tsx`
- `client/src/app/settings/[section]/_components/SettingsView/_components/SettingsRepoModels/styles.ts`
- `client/src/app/settings/[section]/_components/SettingsView/_components/SettingsRepoModels/index.ts`
- `client/src/app/settings/[section]/_components/SettingsView/SettingsView.tsx`
- `client/messages/en/settings.json`
Test: `pnpm typecheck` + `pnpm test`; RTL test — selecting a repo + a model calls
`useSetRepoIntentModel`.

Parallelizable clusters: {1, 2, 3, 4} have no cross-deps and can run together. Then 5→6→7→8 form
the server chain; 9 unblocks {10, 11} on the client.

---

## 4. Definition of Done (whole feature)

Typecheck / tests:
- [ ] `cd reviewer-core && npm run typecheck && npm test`
- [ ] `cd server && pnpm typecheck` and `pnpm test` (unit + `*.it.test.ts`)
- [ ] `cd client && pnpm typecheck && pnpm test`
- [ ] `pnpm db:generate` yields exactly one migration (adds `repo_feature_models`, nothing
      else); `pnpm db:migrate` applies clean.

Behavioral / requirement coverage:
- [ ] `FEATURE_MODELS.review_intent` default is a flash-class **OpenRouter** model in all three
      registries (server vendored, client vendored, client `lib/feature-models.ts`); server
      restarted so the cached `DEFAULTS` reflects it.
- [ ] `POST /pulls/:id/intent/recalculate` classifies and upserts `pr_intent`; it is the ONLY
      write path (no auto-recompute on PR sync / on review run).
- [ ] `GET /pulls/:id/intent` returns the stored `Intent` (or `null`); the Intent card renders it
      above findings, before the description.
- [ ] **Token-savings measured & logged** (decision #7): every `recalculate` logs a structured
      line `{ prId, fullDiffChars, hunkOnlyChars, savedChars, savedPct, estFullTokens,
      estHunkTokens }` (tokens ≈ chars/4, the repo's existing heuristic). The classifier receives
      hunk headers only — never a full patch body. Verifiable in server logs and asserted in the
      recalc `*.it.test.ts`.
- [ ] **Graceful no-context case** (decision #5): a PR with NO linked issue and NO spec/plan in
      the body still classifies and returns a best-effort `Intent` from title + body prose + file
      list + hunk headers. Not an error, not skipped. Covered by a test using a body without a
      `closes/fixes/resolves #N` reference (and the mock adapter's `linked_issue: null`).
- [ ] **Plan-in-body / link-to-plan case** (decision #6): the classifier receives the
      **untruncated** body (own `MAX_INTENT_BODY_CHARS = 16_000`, NOT the review's 4000), so an
      embedded plan or a link to a plan in the body is taken into account. Following external
      URLs is explicitly out of scope. Covered by a test with a long plan-bearing body that
      exceeds 4000 chars and asserting it reached the classifier input intact.
- [ ] Injected intent is wrapped: `## Intent` shows the trusted scope-policy sentence OUTSIDE
      `<untrusted source="intent">` and the derived summary/scope INSIDE; the main agent honors
      "don't comment out of scope; one flagged signal for serious out-of-scope issues".
- [ ] `prompt_assembly.intent` appears in the Run Trace when a PR has a stored intent, and is
      `null` otherwise (field is `.nullish()`; old traces still parse).
- [ ] Per-repo override works: `PUT /repos/:id/intent-model` sets the row; resolution order is
      repo → workspace → registry default; the endpoint rejects repos outside the caller's
      workspace (A01). Selectable both on the Intent card and in Settings → Models.
- [ ] i18n: all new user-facing strings are `next-intl` keys (`prReview.json`, `settings.json`);
      no hardcoded copy, no `window.confirm` English strings.

Edge cases:
- [ ] Recalculate on a PR whose repo is not cloned / GitHub offline: still classifies from stored
      title/body/files; linked issue omitted; no crash.
- [ ] Empty diff / no `prFiles`: classifier still runs on title + body; hunk-header list empty.
- [ ] Recalculate is rate-limited (10/min) like `/pulls/:id/review`.

---

## 5. Risks and assumptions

- **Model SKU choice.** `google/gemini-2.5-flash` is a sensible current OpenRouter flash default
  (decision #2 left the exact SKU to the planner). If the team prefers a different flash model,
  it is a single constant in three registries — no other code changes.
- **Structured output on a flash model.** The `Intent` schema is small; flash models on
  OpenRouter support structured/function-calling, and `completeStructured` already retries. The
  `Intent.safeParse` guard catches a malformed response — on failure the route should return a
  clean 4xx/5xx (do NOT persist a partial intent). Assumed acceptable; surfaced here so the
  implementer wires the error path rather than silently upserting garbage.
- **Mock adapter has no linked issue** (`mocks.ts:183`) — the linked-issue branch is only
  exercisable against the real GitHub adapter; dev/mock paths always hit the graceful no-issue
  case. Called out so the classifier's no-issue behavior is what CI actually tests.
- **Per-repo override UI lives in two places** (Intent card + Settings → Models). Both write the
  same `repo_feature_models` row via the same hook, so they stay consistent; if the team wants
  only one surface, drop Step 11 (Settings) — the card alone satisfies "override per-repository",
  though the feature brief's "configurable in Settings" wording is best met by keeping both.
- **Assumption:** `container.llm(provider)` and `completeStructured({ schema, schemaName,
  temperature, messages })` behave exactly as in `ConventionsService.extract` (confirmed by
  reading that service). If the OpenRouter provider signature differs for `google/*` models, the
  classifier call is the only place to adjust.
- **No new observability infra** (decision in §1.3): the classifier does NOT create an
  `agent_run` / `run_trace`; token savings go to the structured server log + the recalc response.
  If the team later wants intent runs in the run history, that is a follow-up, not this spec.
</content>
</invoke>
