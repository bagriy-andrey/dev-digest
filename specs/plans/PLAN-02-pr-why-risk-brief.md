# Implementation Plan: PR Why + Risk Brief (SPEC-02)

**Status:** planning
**Scope:** shared contracts (both vendored copies) · server (`@devdigest/api`) · client (`@devdigest/web`)
**Spec:** `specs/SPEC-02-pr-why-risk-brief.md` (source of truth for WHAT/WHY — do not re-litigate behavior here)
**Execution mode:** single-agent (recommended) — see §3. The server track (steps 2→3) and the client track (steps 4→5) are independent after step 1 and could be split multi-agent, but the vendored-`shared` hand-sync + "server `tsc` pulls reviewer-core source" gotchas make a single sequential pass safer (same reasoning as PLAN-01).

> This document is HOW to build an already-specced feature, file-by-file, in
> dependency order. Every step lists the exact files it owns; no two steps share
> a file. The Implementer executes one step at a time.

## Resolved clarifications (do NOT re-ask — decided before planning, per the spec's own grounded defaults)

The spec's `## [NEEDS CLARIFICATION]` (~line 410) + inline markers are all resolved to the spec's stated defaults:

- **`review_focus` item shape** → `{ file, reason }` (richer than `string[]`), **no** optional `line`. (AC-7.)
- **`risk_level` derivation** → **model-produced** as part of the single structured call; the empty-`risks[]` case stays a valid low-risk brief (AC-10). No deterministic `max(severity)` normalization.
- **Cache storage** → reuse the existing `pr_brief` table's generic `json` jsonb column, overwrite-on-regenerate. **Provenance is log-only** — NO new `model`/`cost`/`input_size` columns, therefore **no DB migration in this feature**.
- **`PrBriefCard` mount position** → **top of the Overview tab, above `IntentCard`**. Does not modify the existing cards (AC-18).
- **"Relevant specs" source + cap** → a **bounded** set: enumerate the repo's discovered Context-Folder docs via `ContextService.listForRepo`, take a **capped slice** (constant `MAX_BRIEF_SPEC_DOCS` + a per-corpus char cap), read each via `ContextService.getFileContent`, treat as untrusted. Protects the ≤ 8K budget.
- **`risk_brief` model default** → **correct it to a flash SKU** (`openrouter` / `google/gemini-2.5-flash`, matching the corrected `review_intent` entry) in this feature, in all three places it is declared (see step 1).

## Naming-collision guardrails the Implementer MUST honor (from the spec's dedicated warning + root `insights.md`)

Four similarly-named artifacts coexist. This feature touches ONLY the ones marked "use":

1. **`Brief`** (NEW — `{what, why, risk_level, risks[], review_focus[]}`) — **build this.**
2. **`PrBrief`** contract (`contracts/brief.ts:124-130`, `{intent, blast, risks, history}`) — **do NOT produce, consume, or repurpose.** Leave it untouched.
3. **`pr_brief` table** (`schema/reviews.ts:57-62`, `{pr_id PK, json jsonb}`) — **use as the `Brief` cache** despite the misleading name. It has zero existing writers/readers (grep-confirmed).
4. **`WhyTimeline` / `contracts/why.ts`** git-blame "why does this line exist" feature — **completely unrelated; do not import, extend, or align.** `Brief.why` is a PR-level narrative, not per-line blame.

---

## 0. What already exists (do not touch / do not rebuild)

All audited against the current tree. `reviewer-core` needs **zero source edits** — it only exports `wrapUntrusted`, which the new server helper imports.

| Artifact | Location | State / how it's used here |
|---|---|---|
| `Risk` contract `{kind,title,explanation,severity,file_refs[]}` + `RiskSeverity = enum('high','medium','low')` | `contracts/brief.ts:55-65` (both vendored copies) | **Reused verbatim** for `Brief.risks[]` / `Brief.risk_level`. Do NOT redefine. |
| `Intent` read | `ReviewRepository.getIntent(prId)` → `pull.repo.ts:94`; `IntentService.get` | Read the stored `Intent` for input composition. May be `null` (never classified) — degrade, don't fail. |
| `BlastRadius` read | `BlastService.get(workspaceId, prId)` → `blast/service.ts` | Read summary + downstream facts for input. Pure reads, recomputed per call, no LLM. |
| `SmartDiff` read | `SmartDiffService.get(workspaceId, prId)` → `smart-diff/service.ts` | Derive **per-group counts + changed-file paths only** (AC-2). Deterministic; valid even with zero reviews. |
| Best-effort linked issue | `container.github().getPullRequest(ref, number).linked_issue` — pattern in `intent/service.ts:75-91` | Copy the exact try/catch degrade-silently shape (AC-3). Mock adapter hardcodes `linked_issue: null`. |
| Context specs | `ContextService.listForRepo` + `ContextService.getFileContent` (`modules/context/service.ts:112,140`) | Enumerate + read a capped set of discovered specs (AC-4). `getFileContent` is already path-guarded. |
| `wrapUntrusted(label, content)` | exported from `reviewer-core/src/index.ts:17` (`@devdigest/reviewer-core`) | Wrap every untrusted fact in the composed prompt (Untrusted-inputs mitigation). Server already imports `@devdigest/reviewer-core` in run-executor. |
| `upsertIntent` pattern (`onConflictDoUpdate` on PK) | `pull.repo.ts:79-92` | Mirror shape for the new `upsertBrief` (overwrite-on-regenerate, AC-11). |
| `pr_brief` table `{pr_id PK, json jsonb}` | `schema/reviews.ts:57-62` | Cache home. Already `onDelete: 'cascade'` with the PR (AC edge: PR deleted). No schema change needed. |
| `resolveFeatureModel(container, workspaceId, id)` | `settings/feature-models.ts:51` | Workspace-level resolver — use for `'risk_brief'`. (NOT `resolveFeatureModelForRepo`; per-repo override is a Non-goal.) |
| `getContext(app.container, req)` guard + `IdParams` | `modules/_shared/context.js`, `_shared/schemas.js` | Workspace-scope every route (mirror `intent/routes.ts`). |
| Per-route `config.rateLimit` on paid-LLM POST | `intent/routes.ts:33-39` (`/pulls/:id/intent/recalculate`, `max:10, timeWindow:'1 minute'`) | Mirror on `POST /pulls/:id/brief` (AC-13). Note: rate-limit is inert under `NODE_ENV=test` — assert it by source-read, not a live 429 (server insights). |
| `IntentCard` "Recalculate" control (`Button` icon `RefreshCw`, `loading`, `SectionLabel right=`) | `IntentCard.tsx:41-57` | Mirror for the Brief's Generate/Regenerate control (AC-17). `SectionLabel`'s `right?` slot holds the button. |
| `onOpenInDiff(file, line\|null)` click-to-code | `page.tsx:76` `openInDiff`; usage `BlastRadiusCard.tsx:124` (`MonoLink onClick={() => onOpenInDiff(c.file, c.line)}`) | **Reuse unchanged** for `review_focus` deep-links (AC-16). Threaded to `OverviewTab` already. |
| `OverviewTab` receives `onOpenInDiff`, renders `IntentCard`→`BlastRadiusCard`→Description | `OverviewTab.tsx` | Mount `PrBriefCard` FIRST (above `IntentCard`). `page.tsx` needs NO edit — it already passes `onOpenInDiff`. |
| `usePrIntent`/`useRecalculateIntent` hook pair | `client/src/lib/hooks/intent.ts` | Mirror for `usePrBrief`/`useGenerateBrief`. |
| `lib/types.ts` re-export hub (already re-exports `PrBrief`/`Intent`/`BlastRadius`/`SmartDiff`) | `client/src/lib/types.ts:42` | Add `Brief`/`ReviewFocusItem` to the re-export line. |
| `lib/hooks/index.ts` barrel (NOT auto-populated) | `client/src/lib/hooks/index.ts` | Add `export * from "./brief";` (per client insights — a new hook file isn't reachable via `@/lib/hooks` otherwise). |

---

## 1. Module breakdown (dependency order: shared → server → client)

### 1A. Shared contracts + model defaults (VENDORED — edit BOTH copies by hand, keep byte-identical)

Vendored copies: `server/src/vendor/shared/contracts/*` (covers server **and** reviewer-core, which aliases to the server copy) AND `client/src/vendor/shared/contracts/*`. Plus the client's runtime feature-model registry and type re-export hub.

**Modify** `contracts/brief.ts` (BOTH vendored copies)
- Add the NEW `ReviewFocusItem` and `Brief` contracts, placed after the existing `Risk`/`RiskSeverity` block (so they can reference those names) and BEFORE the composed `PrBrief`:
  ```
  export const ReviewFocusItem = z.object({ file: z.string(), reason: z.string() });
  export type ReviewFocusItem = z.infer<typeof ReviewFocusItem>;

  export const Brief = z.object({
    what: z.string(),
    why: z.string(),
    risk_level: RiskSeverity,       // reused verbatim (AC-6)
    risks: z.array(Risk),           // reused verbatim (AC-6)
    review_focus: z.array(ReviewFocusItem),  // (AC-7)
  });
  export type Brief = z.infer<typeof Brief>;
  ```
- Do **not** modify `PrBrief`, `Risk`, `RiskSeverity`, or any other existing export.
- Confirm both copies export `Brief`/`ReviewFocusItem` from the package index if that index re-exports `brief.ts` names (check `contracts/index.ts` or the barrel each vendored copy uses; add the re-export if the file uses an explicit allowlist rather than `export *`).

**Modify** `contracts/platform.ts` (BOTH vendored copies) — correct the `risk_brief` default
- In `FEATURE_MODELS`, change the `risk_brief` entry's `defaultProvider: 'openai' / defaultModel: 'gpt-4.1'` → `defaultProvider: 'openrouter' / defaultModel: 'google/gemini-2.5-flash'` (mirrors the corrected `review_intent` entry two slots above). Leave `id`/`label`/`description` unchanged. Do not touch other entries.

**Modify** `client/src/lib/feature-models.ts` — the client's RUNTIME registry (the UI reads THIS, not the vendored copy; the two have drifted before — client insights)
- Correct the `risk_brief` entry's provider/model default to the same flash SKU. This is the value the Settings UI renders.

**Modify** `client/src/lib/types.ts` — re-export hub
- Add `Brief` and `ReviewFocusItem` to the `export type { … } from "@devdigest/shared";` line (currently exports `PrBrief, SmartDiff, Intent, BlastRadius`).

> **Restart caveat (server insights):** `tsx watch` does NOT hot-reload `vendor/shared/**`; `DEFAULTS` in `feature-models.ts` is computed at module load. The flash-default change has no runtime effect until the server process is restarted — relevant only for manual verification, not for typecheck/tests.

### 1B. Server — repository cache methods (Infrastructure layer)

**Modify** `server/src/modules/reviews/repository/pull.repo.ts`
- Add `upsertBrief(db, prId, brief: Brief): Promise<void>` — `insert(t.prBrief).values({ prId, json: brief }).onConflictDoUpdate({ target: t.prBrief.prId, set: { json: brief } })` (mirror `upsertIntent`, AC-11: overwrite, no versioning).
- Add `getBrief(db, prId): Promise<Brief | undefined>` — select the row, `return row ? Brief.parse(row.json) : undefined`. Parse defensively (the `json` column is untyped jsonb); on parse failure treat as "not generated yet" (`undefined`) rather than throwing, so a legacy/garbage row degrades to the empty state.
- Import `Brief` (value schema, for `.parse`) + type from `@devdigest/shared`.

**Modify** `server/src/modules/reviews/repository.ts` (class facade)
- Add the two passthroughs mirroring `getIntent`/`upsertIntent` (`repository.ts:139-145`): `getBrief(prId)` → `pullRepo.getBrief(this.db, prId)`, `upsertBrief(prId, brief)` → `pullRepo.upsertBrief(this.db, prId, brief)`. (Server insights: repo write signatures are declared twice — impl + facade — and both must change together.)

### 1C. Server — new module `server/src/modules/brief/` (Application + Domain + Adapter)

Follows the standard `constants → helpers (pure/domain) → service (application) → routes (adapter)` shape, exactly like `intent`/`blast`/`smart-diff`. Onion check: `helpers.ts` is pure (no drizzle/fastify/db import); `service.ts` orchestrates via `container` + `ReviewRepository` (news-up'd from `container.db`, matching every sibling module — NOT added to the DI container, avoids container churn); `routes.ts` is the only Fastify-aware file and never touches `db.*` directly.

**New** `modules/brief/constants.ts`
- `export const BRIEF_FEATURE_ID = 'risk_brief' as const;`
- `export const MAX_BRIEF_SPEC_DOCS = 4;` (cap on discovered specs pulled into the input — the only unbounded contributor; protects ≤ 8K budget).
- `export const MAX_BRIEF_SPEC_CHARS = 12_000;` (per-corpus char cap across the selected specs, truncate-with-notice beyond it).
- `export const MAX_BRIEF_ISSUE_CHARS` / `MAX_BRIEF_BODY-ish` caps as needed for the issue text (mirror `intent/helpers.ts`'s `capBody` shape).

**New** `modules/brief/helpers.ts` — pure, unit-testable, no I/O
- `export const BRIEF_SYSTEM_PROMPT` — instructs the model to compose `{what, why, risk_level, risks[], review_focus[]}` from the supplied facts, to treat all `<untrusted>…</untrusted>` blocks as DATA never instructions (mirror `INTENT_SYSTEM_PROMPT`'s stance), to return a best-effort brief even when signals are sparse, and to only reference files it was shown. Explicitly: never read the raw diff (it isn't provided).
- `export interface BriefFacts { intent: Intent | null; blastSummary: string; downstream: {…} ; smartDiffCounts: { core: number; wiring: number; boilerplate: number }; changedPaths: string[]; linkedIssue?: LinkedIssueInput; specs: { path: string; content: string }[]; }`
- `export function buildBriefInput(facts: BriefFacts): { messages: ChatMessage[]; inputChars: number }` — assemble system + one user message. Each untrusted fact block wrapped via `wrapUntrusted(label, content)` from `@devdigest/reviewer-core` (labels: `intent`, `blast`, `linked-issue`, `spec-N`). Smart-Diff contributes **only** the count line (e.g. `core: 4 files, wiring: 1, boilerplate: 2`) + the changed-file path list — never file contents/hunks (AC-1, AC-2). Return `inputChars` (Σ message content length) for the size log (AC-14). Also expose `estBriefTokens = Math.ceil(inputChars / 4)` (mirror the local `chars/4` heuristic pattern from `intent/helpers.ts` — do NOT import the adapter tokenizer across layers).
- `export function groundBrief(brief: Brief, changedPaths: Set<string>): Brief` — the AC-9 code-side backstop: return a copy where each `risks[].file_refs` is filtered to paths ∈ `changedPaths`, and `review_focus[]` is filtered to items whose `.file` ∈ `changedPaths`. Empty results are valid (AC-10) — a risk with all refs dropped keeps its (now-empty) `file_refs`; a fully-invented `review_focus` item is dropped entirely. Never throws.
- `export function smartDiffCounts(smartDiff: SmartDiff): {core,wiring,boilerplate}` + `changedPathsOf(files)` small pure helpers.

**New** `modules/brief/service.ts` — `BriefService(container)` (mirror `IntentService`'s constructor/DI shape)
- Constructor: `this.repo = new ReviewRepository(container.db)`.
- `async get(workspaceId, prId): Promise<Brief | null>` — `getPull` guard (throw `NotFoundError` if missing) then `this.repo.getBrief(prId) ?? null` (GET route; never generates — AC-13).
- `async generate(workspaceId, prId, logger?): Promise<{ brief: Brief; metrics }>` — the one write path (Generate AND Regenerate are the same POST):
  1. `getPull` guard; `getRepo`.
  2. Gather facts (all best-effort/degrading, never fatal except a hard PR-not-found):
     - `intent = await this.repo.getIntent(prId) ?? null`.
     - `blast = await new BlastService(this.container).get(workspaceId, prId)` → take `.summary` + `.downstream` (cross-module service news-up is an accepted pattern here — `intent`/`onboarding` already import sibling repos/services directly).
     - `smartDiff = await new SmartDiffService(this.container).get(workspaceId, prId)` → `smartDiffCounts(...)`.
     - `changedPaths = (await this.repo.getPrFiles(prId)).map(f => f.path)` (also the grounding set).
     - linked issue via `container.github().getPullRequest(ref, pull.number)` in a try/catch that degrades to `undefined` (copy `intent/service.ts:73-91`) (AC-3).
     - specs: `const docs = await new ContextService(this.container).listForRepo(workspaceId, pull.repoId)`; take first `MAX_BRIEF_SPEC_DOCS`, read each with `getFileContent(workspaceId, pull.repoId, doc.path)`, char-cap to `MAX_BRIEF_SPEC_CHARS`; on any read error skip that doc. Empty set is fine (AC-4).
  3. `resolveFeatureModel(this.container, workspaceId, BRIEF_FEATURE_ID)` (workspace-level only).
  4. `const { messages, inputChars, estBriefTokens } = buildBriefInput(facts)`.
  5. `const llm = await this.container.llm(provider as …)`; `const result = await llm.completeStructured({ model, schema: BriefSchema, schemaName: 'pr_brief', temperature: 0.1, messages })` — **exactly one** call (AC-5).
  6. `const parsed = Brief.safeParse(result.data)`; on failure `throw new ExternalServiceError(...)` — do NOT persist, leaving any prior cached brief untouched (AC-8). This is also defense-in-depth over provider structured mode (mirror `intent/service.ts:119-125`).
  7. `const grounded = groundBrief(parsed.data, new Set(changedPaths))` (AC-9).
  8. `await this.repo.upsertBrief(prId, grounded)` (AC-11 — overwrite; no reindex/review side effect, AC-12).
  9. `logger?.info({ prId, model, provider, tokensIn: result.usage?…, tokensOut: …, inputChars, estBriefTokens }, 'brief: generated …')` (AC-14 — logged, never returned to the card). Return `{ brief: grounded, metrics }`.
- No `agent_run`/`run_trace` is created (same decision as `IntentService`; observability is the structured log line).
- Reuse the `Logger` type shape from `intent/service.ts` (pino-compatible `{info,warn,error}`), fed `req.log` by the route.

**New** `modules/brief/routes.ts` — default Fastify plugin, Zod via `fastify-type-provider-zod` (mirror `intent/routes.ts`)
- `GET  /pulls/:id/brief`  → `{ schema: { params: IdParams, response: { 200: Brief.nullable() } } }` → `getService().get(workspaceId, id)` (AC-13: cached `Brief` or `null` "not generated yet").
- `POST /pulls/:id/brief` → `{ schema: { params: IdParams, response: { 200: Brief } }, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }` → `const { brief } = await getService().generate(workspaceId, id, req.log); return brief;` (AC-13: rate-limited like `/intent/recalculate`).
- Both workspace-scoped via `getContext(app.container, req)`.

**Modify** `server/src/modules/index.ts`
- Add `import brief from './brief/routes.js';` and one `brief,` entry in the `modules` record. (Only this step touches this file.)

**New** `server/test/brief.test.ts` — hermetic unit tests (vitest; no DB). Covers: `buildBriefInput` excludes any diff body / hunk text and includes only smart-diff counts+paths (AC-1/AC-2); grounding drops invented `file_refs`/`review_focus.file` and keeps real ones (AC-9); empty-`risks[]` stays a valid `Brief` (AC-10); `Brief.risks`/`risk_level` are the reused `Risk`/`RiskSeverity` types (AC-6, compile+parse assertion); `review_focus` is `{file,reason}[]` (AC-7). Service-level single-call assertion (AC-5) + no-persist-on-invalid (AC-8) + log-line contains model/tokens/inputChars and is not in the returned brief (AC-14) via a stubbed `container.llm`/`ReviewRepository`/sibling services (object-literal-cast pattern from server insights — `BriefService`'s `repo`/news-up'd sibling services are overwritten post-construction with stubs).

**New** `server/test/brief.it.test.ts` — real-Postgres (`.it.test.ts` suffix, testcontainers). Covers: generate → `pr_brief` row upserted, second generate overwrites the same `pr_id` row (AC-11/AC-12); linked-issue-failure path still produces a brief (AC-3); no-specs path still produces a brief (AC-4); POST route rate-limit config present (source-read assertion — inert under `NODE_ENV=test`, server insights). *(Testcontainers cannot start PG in this sandbox — write + typecheck it, verify logic by reading + the hermetic suite, and say so in the summary.)*

### 1D. Client (feature-based colocation under the PR-detail route — matches `IntentCard`/`BlastRadiusCard`)

**New** `client/src/lib/hooks/brief.ts` — TanStack Query hooks (through `lib/api.ts`; mirror `hooks/intent.ts`)
- `usePrBrief(prId: string | null)` → `useQuery(["pr-brief", prId], () => api.get<Brief | null>(\`/pulls/${prId}/brief\`), { enabled: !!prId })`.
- `useGenerateBrief(prId: string | null)` → `useMutation(() => api.post<Brief>(\`/pulls/${prId}/brief\`), { onSuccess: (data) => qc.setQueryData(["pr-brief", prId], data) })`. One mutation serves both Generate and Regenerate.
- Import `Brief` from `@/lib/types`.

**Modify** `client/src/lib/hooks/index.ts` — add `export * from "./brief";` (barrel is not auto-populated — client insights).

**New** `client/src/app/repos/[repoId]/pulls/[number]/_components/PrBriefCard/**` (`PrBriefCard.tsx`, `styles.ts`, `index.ts`; `constants.ts`/`helpers.ts` only if needed — follow the co-location convention)
- Props: `{ prId: string | null; repoId: string; onOpenInDiff: (file: string, line: number | null) => void }`. Reads ONLY `usePrBrief`/`useGenerateBrief` — never `VerdictBanner`/`IntentCard`/`BlastRadiusCard` state (AC-18).
- Header: `SectionLabel` with a `right` slot Button mirroring `IntentCard` (`icon="RefreshCw"`, `loading={generate.isPending}`). Label = **Generate** when no brief exists, **Regenerate** when one does (AC-15/AC-17); pending state while in flight.
- Body: empty state (no brief) = message + the Generate CTA, NOT an error (AC-15). With a brief: `what`, `why`, a `risk_level` indicator **distinguished by colour AND a non-colour text/icon cue** (accessibility non-functional req — colour alone is insufficient; reuse `SeverityBadge` from `@devdigest/ui` if its severity maps to `high|medium|low`, else a labelled chip), the `risks[]` list, and the `review_focus[]` list.
- `review_focus[]` items are clickable via `onOpenInDiff(item.file, null)` — reuse `MonoLink onClick={…}` exactly as `BlastRadiusCard.tsx:124` does; introduce NO new deep-link mechanism (AC-16). Pass `null` for line (no `line` field in `ReviewFocusItem` per resolved default).
- Renders NO token/cost/model figure (AC-14). All strings via next-intl (`prReview` namespace).
- `styles.ts`: typed `s` object (`as const satisfies …`). Risk colours must use theme CSS vars, not hardcoded hex (client insights CSS-var-fallback trap).

**Modify** `client/src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/OverviewTab.tsx`
- Import `PrBriefCard`; render it FIRST, above `<IntentCard>`, passing `prId`, `repoId`, and the existing `onOpenInDiff` prop the tab already receives. No other change; `IntentCard`/`BlastRadiusCard`/Description untouched (AC-18). `page.tsx` needs no edit.

**Modify** `client/messages/en/prReview.json`
- Add a `brief` block: `label`, `generate`, `regenerate`, `generating`, `empty`, `loading`, `generateError`, `what`, `why`, `riskLevel`, per-level labels (`high`/`medium`/`low`), `risks`, `reviewFocus`. No hardcoded English in the component (client insights i18n-bypass warnings).

**New** `client/src/app/repos/[repoId]/pulls/[number]/_components/PrBriefCard/PrBriefCard.test.tsx` — RTL, mocked `fetch`/hooks (follow the static-import + `vi.fn().mockReturnValue()` pattern from client insights, NOT dynamic `import()` + shared closures). Covers: empty state renders Generate CTA not an error (AC-15); populated state renders what/why/risk-level(with non-colour cue)/risks/review_focus; clicking a `review_focus` item calls `onOpenInDiff` with the file (AC-16); Regenerate shows pending state (AC-17); card contains no token/cost figure (AC-14 client half); risk conveyed with a text/icon label, not colour alone (a11y).

---

## 2. Dependency changes

- **No DB migration.** Provenance is log-only (resolved default) and the `pr_brief` table already exists with the right shape and cascade — nothing to `db:generate`.
- **No new npm packages.** `wrapUntrusted` comes from the already-consumed `@devdigest/reviewer-core`; `@dnd-kit`/Markdown/etc. not needed.
- **No new env vars, no new secrets, no new outbound calls** beyond the already-configured LLM provider (Untrusted-inputs §: this feature adds no new write scope or auto-run).
- **Vendored `@devdigest/shared` edits (step 1)** must be mirrored BY HAND in BOTH `server/src/vendor/shared` and `client/src/vendor/shared` (byte-identical for the changed sections) — they are not npm. Editing the server copy also covers reviewer-core (it aliases to the server copy).
- **Model-default correction lives in THREE files** (step 1): `server/src/vendor/shared/contracts/platform.ts`, `client/src/vendor/shared/contracts/platform.ts`, and `client/src/lib/feature-models.ts` (the runtime one the UI actually reads — the two client files have drifted before).
- **`reviewer-core/node_modules` must be installed** in the checkout/worktree or `cd server && pnpm typecheck` fails resolving `openai`/`zod` inside reviewer-core source (server insights): `cd reviewer-core && npm install` once (reviewer-core uses npm, not pnpm).

---

## 3. Execution order

**Single-agent recommended.** After step 1, the server track (2→3) and client track (4→5) are independent (disjoint files, no cross-dependency) and *could* be handed to two parallel Implementers. But the vendored-`shared` hand-sync and the "server `tsc` pulls reviewer-core source" gotchas favor one sequential pass keeping the contracts in lockstep — same call as PLAN-01. If switched to multi-agent: run step 1 alone first, then steps {2→3} and {4→5} as two parallel chains.

Each step lists the exact files it OWNS (disjoint across all steps).

**Step 1 — shared contracts + model defaults + client type re-export.** Depends on: none.
Owns: `server/src/vendor/shared/contracts/brief.ts`, `server/src/vendor/shared/contracts/platform.ts`, `client/src/vendor/shared/contracts/brief.ts`, `client/src/vendor/shared/contracts/platform.ts`, `client/src/lib/feature-models.ts`, `client/src/lib/types.ts` (+ each vendored copy's contract barrel/index only if it uses an explicit allowlist).
Done when: `Brief` + `ReviewFocusItem` exist byte-identical in both vendored `brief.ts`; `risk_brief` default is the flash SKU in both vendored `platform.ts` + `client/src/lib/feature-models.ts`; `client/src/lib/types.ts` re-exports `Brief`/`ReviewFocusItem`; server + client `pnpm typecheck` green; `server/test/contracts.test.ts` still passes (new contracts additive, existing literals unaffected — but re-run it, it round-trips every `brief.ts` building block).
Test criteria → AC-6, AC-7 (contract shape: `risks:Risk[]`, `risk_level:RiskSeverity`, `review_focus:{file,reason}[]`).

**Step 2 — server repository cache methods.** Depends on: 1.
Owns: `server/src/modules/reviews/repository/pull.repo.ts`, `server/src/modules/reviews/repository.ts`.
Done when: `getBrief`/`upsertBrief` exist on impl + facade, mirror `getIntent`/`upsertIntent`, parse defensively; `cd server && pnpm typecheck` green.
Test criteria → AC-11 (upsert overwrites the single `pr_id` row — exercised end-to-end in step 3's `.it.test.ts`).

**Step 3 — server brief module + registration + tests.** Depends on: 1, 2.
Owns: `server/src/modules/brief/constants.ts`, `server/src/modules/brief/helpers.ts`, `server/src/modules/brief/service.ts`, `server/src/modules/brief/routes.ts`, `server/src/modules/index.ts`, `server/test/brief.test.ts`, `server/test/brief.it.test.ts`.
Done when: hermetic suite green (`pnpm exec vitest run --exclude '**/*.it.test.ts'`); `pnpm typecheck` green; `.it.test.ts` written + typechecked (execution blocked by sandbox testcontainers — note in summary).
Test criteria → AC-1, AC-2, AC-5, AC-8, AC-9, AC-10, AC-14 (log half) via `brief.test.ts`; AC-3, AC-4, AC-11, AC-12, AC-13 via `brief.it.test.ts` (+ source-read for the POST rate-limit config).

**Step 4 — client brief hooks.** Depends on: 1.
Owns: `client/src/lib/hooks/brief.ts` (new), `client/src/lib/hooks/index.ts` (barrel — add one export line).
Done when: hooks typecheck against `Brief` from `@/lib/types`; `cd client && pnpm typecheck` green.
Test criteria → supports AC-15/AC-16/AC-17 (query/mutation surface the card consumes).

**Step 5 — client PrBriefCard + OverviewTab mount + i18n + test.** Depends on: 4.
Owns: `client/src/app/repos/[repoId]/pulls/[number]/_components/PrBriefCard/**` (new folder: `PrBriefCard.tsx`, `styles.ts`, `index.ts`, `PrBriefCard.test.tsx`), `client/src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/OverviewTab.tsx`, `client/messages/en/prReview.json`.
Done when: card renders above `IntentCard`; empty state shows Generate CTA (not error); populated state renders what/why/risk-level(non-colour cue)/risks/review_focus; `review_focus` click calls `onOpenInDiff`; Regenerate pending state; no token/cost figure; all strings i18n; RTL test + `pnpm typecheck` + `pnpm test` green.
Test criteria → AC-15, AC-16, AC-17, AC-18, AC-14 (client half — card shows no figures).

> Steps 2→3 (server) and 4→5 (client) form two disjoint chains after step 1 → parallelizable if multi-agent. Step 1 must land first (both chains depend on the `Brief` contract).

---

## 4. Definition of Done (whole feature)

- [ ] **shared**: `Brief`/`ReviewFocusItem` byte-identical in both vendored `contracts/brief.ts`; `risk_brief` flash default in both vendored `platform.ts` + `client/src/lib/feature-models.ts`; diff the vendored copies to confirm the changed sections match.
- [ ] **server**: `pnpm typecheck` green; `pnpm exec vitest run --exclude '**/*.it.test.ts'` green (input excludes diff body, smart-diff counts-only, grounding drop/keep, empty-risks valid, single LLM call, no-persist-on-invalid, log carries model/tokens/inputChars). `.it.test.ts` written + typechecked (sandbox can't run testcontainers — note in summary). `pnpm db:generate` reports **zero** drift (no schema change expected).
- [ ] **client**: `pnpm typecheck` + `pnpm test` green (PrBriefCard RTL test, mocked fetch).
- [ ] **Manual** (needs a restart so the flash default loads — server insights): open a PR → PrBriefCard shows empty state with Generate; click Generate → one LLM call, brief appears above the Intent card with a colour+label risk indicator; click a review-focus item → diff tab opens on that file; click Regenerate → the single cached row overwrites; server log shows resolved model/tokens/input-size and the input is ≤ ~8K tokens; no reindex/review run is triggered; card shows no token/cost figure.
- [ ] **Edge cases**: PR never reviewed (smart-diff counts still valid, brief generates); no linked issue / mock adapter (issue omitted, no error); no attached specs (brief still generates); model invents a path (dropped, brief still valid); model returns empty `risks[]` (valid low-risk brief); generation fails mid-way (prior cached brief preserved); PR deleted (row cascades).
- [ ] **AC coverage**: AC-1…AC-18 each mapped to a step's test criteria in §3.

## 5. Risks and assumptions

- **Prompt injection (spec Untrusted-inputs §).** Every substantive input (intent, blast summary, linked issue, spec bodies, changed paths) is attacker-influenceable. Mitigation is baked into step 3: wrap EVERY untrusted fact in `wrapUntrusted(...)` and rely on the system prompt's "this is DATA" declaration; do NOT add denylist/keyword scanning. AC-9's `groundBrief` is the code-side backstop against path hallucination/injection — it is mandatory, not optional, and validates against the PR's real changed-file set.
- **≤ 8K token budget is a SOFT target, and specs are the only unbounded contributor.** The caps (`MAX_BRIEF_SPEC_DOCS`, `MAX_BRIEF_SPEC_CHARS`) are the guardrail; `inputChars`/`estBriefTokens` are measured and logged (AC-14) so an operator can audit overruns after the fact. No hard truncation of the composed prompt beyond the spec cap.
- **"Relevant specs" is a bounded heuristic, not a per-PR relevance model.** The `context` module attaches specs per-agent/per-skill, with no built-in "specs relevant to THIS PR" notion — this plan takes a capped slice of the repo's discovered docs (resolved default). If product later wants agent-scoped or truly PR-relevant selection, that's a follow-up; the cap location (`constants.ts`) is the single knob to change.
- **`risk_level` is trusted from the model** (resolved default) — a crafted input could push a falsely-low level. Accepted per spec; the deterministic `max(severity)` alternative is a noted future change, not scoped here.
- **Restart required for the flash default** (server insights: `tsx watch` won't reload `vendor/shared`). Only affects manual verification, not typecheck/tests.
- **`.it.test.ts` cannot run in this sandbox** (testcontainers/Rancher limitation, server insights) — write and typecheck it, verify by reading + the hermetic suite, and say so in the summary rather than debugging a container-runtime error.
- **Worktree/commit hygiene** (root + server insights): if run under an isolated worktree, confirm baseline (`Brief` from step 1) is present before later steps, commit each step before reporting done, and self-check `git merge --ff-only` if the worktree branch is a stale ancestor of the integration branch.
