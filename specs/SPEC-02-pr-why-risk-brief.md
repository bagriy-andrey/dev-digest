# Spec: PR Why + Risk Brief  |  Spec ID: SPEC-02  |  Status: draft
Supersedes: none
Implementation Plan: specs/plans/PLAN-02-pr-why-risk-brief.md

> Lesson L05, item 3 of 3 ("PR Brief card"). The other two L05 items —
> Project Context Folder (`server/specs/SPEC-01-project-context.md`) and the
> Onboarding generator (`specs/SPEC-01-onboarding-generator.md`) — are separate,
> already-specced features and out of scope here. This spec composes three
> earlier, already-*implemented* lesson features (Intent L03, Smart Diff L03,
> Blast Radius L04) plus the Context Folder into one new synthesis.

## Проблема й навіщо

A reviewer opening a PR in DevDigest today gets several *separate* panels — the
Intent card (why the author says they opened it), the Blast Radius card (what
could break), the Smart-Diff grouping (core vs boilerplate), and, after a
review run, the Verdict banner and findings. Each answers one slice. Nobody
produces the one-paragraph answer a busy reviewer actually opens the PR
wanting: **"What is this change, why does it exist, how risky is it, and where
should I look first?"** That synthesis lives only in the reviewer's head after
they've read all the panels.

**PR Why + Risk Brief** produces that synthesis as a single, cached, top-level
document per PR. It is deliberately *nearly free*: its entire LLM input is
composed from facts DevDigest has **already computed cheaply** for the three
sibling lesson features — never the raw diff/patch body — and it makes exactly
**one** structured LLM call to compose them into a new `Brief` contract. The
result is rendered as a `PrBriefCard` on the Overview tab, with a risk-coloured
header and a review-focus list whose items deep-link into the diff at the real
file.

### What already exists (grounding — audited in the repo)

This feature is mostly *composing pre-existing, already-wired features* — the
same "scaffolding exists" shape as Intent/Smart-Diff/Blast, except here the
scaffolding is three *working* upstream features plus two pieces of genuinely
unwired scaffolding (the `pr_brief` table and the `risk_brief` model id):

| Artifact | State | Location (file:line) |
|---|---|---|
| `Intent` contract `{intent, in_scope[], out_of_scope[]}` + `GET /pulls/:id/intent` (stored per-PR in `pr_intent`, never auto-computed) | ✅ implemented (L03) | `contracts/brief.ts:9-14`; `server/src/modules/intent/{service,routes}.ts` |
| `BlastRadius` contract `{changed_symbols[], downstream[], prior_prs[], summary}` + `GET /pulls/:id/blast` (pure repo-intel reads, zero LLM in core path) | ✅ implemented (L04) | `contracts/brief.ts:46-52`; `server/src/modules/blast/{service,routes}.ts` |
| `SmartDiff` contract with three groups `core`/`wiring`/`boilerplate` + `GET /pulls/:id/smart-diff` (deterministic, no LLM) | ✅ implemented (L03) | `contracts/brief.ts:88-121`; `server/src/modules/smart-diff/{service,routes}.ts` |
| Linked-issue resolution (`closes/fixes/resolves #N` → `linked_issue`, best-effort, degrades on offline/mock) | ✅ implemented, reused by Intent | `server/src/adapters/github/octokit.ts`; consumed in `intent/service.ts:75-91` |
| Project Context Folder (discovers `specs/`/`docs/`/`insights/` docs; `ContextService.listForRepo` / `resolveEffectiveSpecs`) | ✅ implemented (SPEC-01) | `server/src/modules/context/service.ts` |
| `Risk` contract `{kind, title, explanation, severity, file_refs[]}` + `RiskSeverity = enum('high','medium','low')` | ✅ exists (both vendored copies) — **reused verbatim** by this feature | `contracts/brief.ts:55-65` |
| `pr_brief` table `{pr_id PK, json jsonb}` | ⚠️ exists, **zero writers/readers** anywhere in `server/src` (grep-confirmed) — the natural per-PR cache home | `server/src/db/schema/reviews.ts:57-62` |
| `risk_brief` `FeatureModelId` (label "Risk Brief", desc "Assesses merge risks for a pull request") | ⚠️ registered but **zero call sites** — default is **`openai/gpt-4.1` (NOT flash)** | `contracts/platform.ts:14-21,67-73` |
| `PrBrief` composed contract `{intent, blast, risks, history}` | ⚠️ exists, unwired — a **DIFFERENT** type; see naming-collision note below | `contracts/brief.ts:124-130` |
| `IntentCard` "Recalculate" button (Button, icon `RefreshCw`, `loading`, `onClick={() => recalculate.mutate()}`) — the manual-regenerate pattern to mirror | ✅ reference | `client/.../_components/IntentCard/IntentCard.tsx:43-54` |
| `OverviewTab` renders `IntentCard` → `BlastRadiusCard` → Description; receives `onOpenInDiff` | ✅ reference | `client/.../_components/OverviewTab/OverviewTab.tsx` |
| Click-to-code `onOpenInDiff(file, line \| null)` → `openInDiff` → switches to `diff` tab (already wired for `FindingsTab`/`BlastRadiusCard`) | ✅ exists — **reuse, do not rebuild** | `client/.../page.tsx:76-79`; usage `BlastRadiusCard.tsx:124` |
| `upsertIntent` per-PR upsert (`onConflictDoUpdate` on PK) — the cache-overwrite pattern to mirror | ✅ reference | `server/src/modules/reviews/repository/pull.repo.ts:79-92` |
| `onboarding` table's precedent of adding `sourceSha`/`costCents` provenance columns to a per-repo doc row | ✅ reference for optional Brief provenance columns | `server/src/db/schema/context.ts:123-131` |

**Net-new work (NOT built by this spec — noted so the reader knows the gap):** a
new `Brief` contract; a `brief` server module (compose service + `GET`/`POST`
routes); a per-PR cache write path over the existing `pr_brief` table; a
`PrBriefCard` client component + hook; and (recommended) correcting the
`risk_brief` model default to a flash SKU. **This spec stops at requirements —
it does not produce that build breakdown** (see Goals/Non-goals).

### Naming-collision warning (state this loudly — three "brief"/"why" names coexist)

Four similarly-named things will exist side by side after this feature ships. An
implementer MUST NOT conflate them:

1. **`Brief`** (new, this feature) — `{what, why, risk_level, risks[], review_focus[]}`.
   The synthesis this feature produces.
2. **`PrBrief`** (pre-existing, `contracts/brief.ts:124-130`) — a *different*
   composed doc `{intent, blast, risks, history}`. Unwired scaffolding. This
   feature does **not** produce, consume, or repurpose `PrBrief`.
3. **`pr_brief` table** (`schema/reviews.ts:57`) — a generic `{pr_id, json}` row,
   currently unused. Reused here as the `Brief` cache (see AC-11 / Contracts),
   *despite* its name reading like it "belongs to" `PrBrief`.
4. **`WhyTimeline`/`WhyEvent`** (`contracts/why.ts`, owned by feature "A3") — a
   git-blame-based "why does *this line* exist?" timeline (`GET /pulls/:id/why`,
   keyboard `w`). This is a **completely unrelated** notion of "why" and is
   **not reused** by this feature. `Brief.why` is a PR-level "why does this
   change exist" narrative, not a per-line blame history. Do not import,
   extend, or align the two.

## Goals / Non-goals

### Goals
- Produce, from **exactly one structured LLM call**, a new `Brief`
  `{what, why, risk_level, risks[], review_focus[]}` per PR, composed **only**
  from already-computed cheap facts (Intent, Blast-radius summary, Smart-Diff
  group *statistics*, the linked issue, and relevant attached specs) — **never
  the PR's raw diff/patch body**.
- Reuse the existing `Risk` contract and `RiskSeverity` enum verbatim for
  `Brief.risks[]` and `Brief.risk_level`; do not invent a parallel risk shape.
- Cache the `Brief` per PR (one row, overwrite-on-regenerate) and expose a
  manual **Regenerate** action mirroring the Intent card's "Recalculate".
- Ground every file reference the model emits (`risks[].file_refs`,
  `review_focus[].file`) against the PR's actual changed-file set, dropping any
  path the model invented.
- Render a self-contained `PrBriefCard` on the Overview tab: risk level shown by
  colour, and a review-focus list whose items deep-link into the diff via the
  existing `onOpenInDiff` wiring.
- Keep the composed LLM input bounded and loggable (soft target ≤ 8K tokens).

### Non-goals (explicitly out of scope)
- **Producing an Implementation Plan.** This spec defines WHAT/WHY only; turning
  it into a file-by-file build is `implementation-planner`'s job (see handoff).
- **Including the raw diff/patch body in the LLM input.** Only Smart-Diff group
  *counts* (and changed-file *paths*, for grounding) are sent — never file
  contents or hunks. This is the "nearly free" invariant.
- **Touching, wrapping, redesigning, or repositioning `VerdictBanner`,
  `IntentCard`, or `BlastRadiusCard`.** Those are separate, already-shipped
  features. `PrBriefCard` renders only its own `Brief` fields. The verdict /
  PR-score / findings-count pipeline output is NOT part of this feature's LLM
  call and is not read by it.
- **`WhyTimeline` (history of briefs across a PR's commits).** No versioning, no
  per-commit brief history; Regenerate overwrites the single cached row. Noted
  future extension. (Also distinct from the unrelated `contracts/why.ts`
  `WhyTimeline` — see naming-collision warning.)
- **Repurposing the `PrBrief` composed contract or its `Risks`/`PrHistory`
  sections.** This feature produces the new `Brief`, not `PrBrief`.
- **A per-repo model override for the brief model** (unlike Intent, which built
  one). The brief resolves its model at the workspace level only. Adding a
  per-repo override is a possible later change, not scoped here.
- **Auto-generation.** The brief is generated/regenerated strictly on manual
  user action — never automatically on PR sync or on review-run completion.
- **New indexing / embedding / RAG work.** Zero new LLM calls beyond the single
  compose call; zero embedding calls; no repo-intel reindex triggered.

## User stories

- **US-1 (reviewer, triage).** As a reviewer opening an unfamiliar PR, I read
  the PR Brief card's *what* / *why* and its risk level at a glance, so I know
  what I'm reviewing and how carefully before I read a single line of diff.
- **US-2 (reviewer, focus).** As a reviewer, I click an item in the brief's
  review-focus list and land on that exact file in the diff, so I start reading
  where the risk actually is instead of top-to-bottom.
- **US-3 (author, self-check).** As a PR author, I generate the brief on my own
  PR and see whether DevDigest's synthesised *why* and risks match my intent —
  a cheap sanity check before requesting review.
- **US-4 (returning reviewer).** As a reviewer revisiting a PR, I see the cached
  brief instantly (no re-generation), and I click **Regenerate** only when the
  PR has moved on, refreshing the single cached brief in place.
- **US-5 (operator).** As an operator, I want each brief generation's model,
  token counts, and composed-input size logged server-side, so I can audit that
  the feature stays "nearly free" (≤ 8K input) and confirm which model ran.

## Acceptance criteria (EARS)

**Composition input (deterministic — reuse of existing features only)**

- **AC-1** WHEN a brief is generated for a PR, the system **shall** compose its
  LLM input from only: the stored `Intent`, the `BlastRadius` summary/downstream
  facts, the `SmartDiff` per-group counts (`core`/`wiring`/`boilerplate`), the
  PR's linked issue (when resolvable), and the relevant attached Context-Folder
  specs — and **shall not** include the PR's raw diff/patch body or any file
  contents. *Verify: unit.*
- **AC-2** The system **shall** derive the Smart-Diff contribution to the input
  as group *counts* and changed-file *paths* only (e.g. "core: 4 files, wiring:
  1, boilerplate: 2"), never as file contents or hunk text. *Verify: unit.*
- **AC-3** WHEN a PR has a resolvable linked issue, the system **shall** include
  the issue's title/body/state in the input; IF linked-issue resolution fails
  (offline, no token, mock adapter, or no linked issue), THEN the system
  **shall** compose the brief without it rather than failing. *Verify:
  integration.*
- **AC-4** The system **shall** include the relevant attached Context-Folder
  specs as input via the existing `context` module, treating them as untrusted
  data (see Untrusted inputs); WHERE no specs are attached/available, the brief
  **shall** still generate from the remaining inputs. *Verify: integration.*

**Single structured LLM call → `Brief`**

- **AC-5** The system **shall** produce the `Brief` `{what, why, risk_level,
  risks[], review_focus[]}` from **exactly one** structured LLM call per
  generation, using the `risk_brief` `FeatureModelId` resolved via the existing
  feature-model resolver — no per-field calls, no additional LLM or embedding
  calls. *Verify: unit.*
- **AC-6** The system **shall** type `Brief.risks[]` as the existing `Risk`
  contract `{kind, title, explanation, severity, file_refs[]}` and
  `Brief.risk_level` as the existing `RiskSeverity` enum (`'high' | 'medium' |
  'low'`), reusing both verbatim from `contracts/brief.ts`. *Verify: unit.*
- **AC-7** The system **shall** type `Brief.review_focus[]` as an array of
  `{file, reason}` items (file path + one-line why-look-here), so each item can
  deep-link to a real file (see AC-9, AC-16). *Verify: unit.*
- **AC-8** IF the structured LLM call fails, or its output fails
  schema/grounding validation, THEN the system **shall** leave any existing
  cached brief for that PR untouched and **shall** report the failure to the
  caller, rather than persisting an empty or partial brief. *Verify:
  integration.*

**Grounding (untrusted-output backstop)**

- **AC-9** WHEN the model returns the `Brief`, the system **shall** drop any
  `risks[].file_refs` entry and any `review_focus[].file` that does not match a
  path in the PR's actual changed-file set, rather than rendering a path the
  model may have invented. *Verify: unit.*
- **AC-10** WHERE `Brief.risks[]` is empty after grounding, the system **shall**
  still return a valid `Brief` (a low-risk PR is a valid result, not an error or
  empty state). *Verify: unit.*

**Caching, regeneration & provenance**

- **AC-11** WHEN a generation succeeds, the system **shall** persist exactly one
  `Brief` per PR (keyed by `pr_id`), overwriting any prior cached brief rather
  than appending a version. *Verify: unit.*
- **AC-12** WHEN a user triggers **Regenerate**, the system **shall** re-compose
  the input (AC-1) and re-run the single LLM call (AC-5) against the PR's current
  facts, overwrite the cached brief, and **shall not** trigger a repo-intel
  reindex or a review run as a side effect. *Verify: integration.*
- **AC-13** The system **shall** expose `GET /pulls/:id/brief` returning the
  cached `Brief` or a "not generated yet" state, and `POST /pulls/:id/brief`
  performing generation/regeneration; the `POST` **shall** be rate-limited like
  the paid-LLM `/pulls/:id/intent/recalculate` route (fans out to a paid LLM).
  *Verify: integration.*
- **AC-14** The system **shall** log, server-side, each generation's resolved
  model, token counts, and the measured composed-input size, and **shall not**
  render any of those figures in the `PrBriefCard`. *Verify: unit (logged) +
  e2e (card contains no token/cost figure).*

**Presentation (client)**

- **AC-15** WHERE a brief exists for a PR, the system **shall** render a
  `PrBriefCard` on the Overview tab showing `what`, `why`, a `risk_level`
  indicator distinguished by colour, the `risks[]` list, and the
  `review_focus[]` list; WHERE no brief exists yet, it **shall** render an empty
  state with a **Generate** call-to-action instead of an error. *Verify: e2e.*
- **AC-16** WHEN a user activates a `review_focus[]` item, the system **shall**
  open that item's file in the diff via the existing `onOpenInDiff(file, line)`
  mechanism, without introducing a new deep-link mechanism. *Verify: e2e.*
- **AC-17** The system **shall** render a **Regenerate** action on the
  `PrBriefCard` whenever a brief exists (and **Generate** when none exists,
  AC-15), mirroring the Intent card's manual-recalculate control, with a pending
  state while the call is in flight. *Verify: e2e.*
- **AC-18** The `PrBriefCard` **shall not** read from, wrap, reposition, or alter
  the `VerdictBanner`, `IntentCard`, or `BlastRadiusCard` — it renders only its
  own `Brief` fields. *Verify: unit/manual (component reads only the brief hook).*

## Edge cases

- **PR never reviewed / no Smart-Diff findings** — the brief still generates;
  Smart-Diff group counts come from the deterministic classifier, which returns
  valid groups even with zero reviews.
- **PR with an empty/degenerate blast radius or degraded repo-intel index** —
  the brief generates from the remaining inputs; blast facts contribute whatever
  is present (possibly empty), not a thrown error.
- **No linked issue / offline / mock GitHub adapter** — issue omitted from input
  (AC-3), not an error. (The mock adapter hardcodes `linked_issue: null`.)
- **Model invents a file path** — dropped per-reference (AC-9), never fails the
  whole brief.
- **Model returns an empty `risks[]`** — valid low-risk brief (AC-10).
- **`risk_level` inconsistent with `risks[]`** (e.g. `high` level, empty risks) —
  see `[NEEDS CLARIFICATION]` on whether to normalise deterministically; default
  is to trust the model's `risk_level` as returned.
- **Generation fails mid-way** — prior cached brief preserved untouched (AC-8).
- **Concurrent Regenerate clicks** — last-write-wins over the single `pr_id` row;
  no locking introduced (consistent with the single-row cache model).
- **Very large attached spec set** — the composed input can exceed the ≤ 8K soft
  budget; the specs are the main variable. See Non-functional + `[NEEDS
  CLARIFICATION]` on capping.
- **PR deleted** — the `pr_brief` row cascades with the PR (existing FK
  `onDelete: 'cascade'`).

## Non-functional

- **Performance.** The whole point is "nearly free": input is a bounded
  composition of already-computed facts (no diff body, no file reads beyond the
  attached specs), plus exactly one structured LLM call (AC-5). Composed input
  size is measured and logged (AC-14) against a **soft ≤ 8K-token budget**;
  Intent, the Blast summary, and Smart-Diff counts are all small and bounded —
  the attached-spec set is the only unbounded contributor and should be capped
  (see `[NEEDS CLARIFICATION]`). Reads of Intent/Blast/Smart-Diff reuse their
  existing endpoints/services; generation never triggers a reindex (AC-12).
- **Security.** Every input except the request framing is attacker-influenceable
  text (PR intent derived from PR body, blast facts from indexed code, diff
  paths, the linked issue, and attached specs). Consult the `security` skill.
  See **Untrusted inputs** — this is a prompt-injection surface, and the brief's
  *output* is a human-facing summary a reviewer may act on, so grounding (AC-9)
  is a code-side backstop, not just a prompt instruction.
- **Accessibility (client).** The `risk_level` colour indicator MUST also carry a
  non-colour cue (text label / icon) so risk is not conveyed by colour alone;
  Generate/Regenerate controls and review-focus links need accessible labels;
  all user-facing strings go through next-intl per `client/AGENTS.md`.
- **Observability.** Each generation logs (server-side): resolved provider/model,
  tokens in/out, composed-input size, and success/failure with a reason
  (AC-14) — so an operator can audit spend, confirm the model, and verify the
  ≤ 8K budget after the fact. Whether the model/cost is also persisted on the
  cached row (mirroring `onboarding.sourceSha`/`costCents`) is an
  implementation-planner decision (see Contracts).

## Workflow & Contracts

### Generate / Regenerate

```mermaid
sequenceDiagram
    autonumber
    participant UI as PrBriefCard (client)
    participant API as brief routes (server)
    participant INT as intent service / pr_intent
    participant BL as blast service (repo-intel)
    participant SD as smart-diff service
    participant GH as GitHub adapter (linked issue)
    participant CTX as context service (specs)
    participant LLM as LLM provider (risk_brief model)
    participant DB as pr_brief (cache)

    UI->>API: POST /pulls/:id/brief  (Generate / Regenerate)
    API->>INT: read stored Intent
    API->>BL: read BlastRadius (summary + downstream)
    API->>SD: read SmartDiff (group counts + changed-file paths)
    API->>GH: best-effort linked issue
    Note over API,GH: failure → omit issue (AC-3), never fatal
    API->>CTX: relevant attached specs (untrusted)
    API->>API: assemble ONE structured-LLM request<br/>(no diff body — AC-1/AC-2; measure input size — AC-14)
    API->>LLM: completeStructured(Brief schema)
    alt success + valid + grounded
        LLM-->>API: Brief { what, why, risk_level, risks[], review_focus[] }
        API->>API: drop invented file_refs / review_focus.file (AC-9)
        API->>DB: upsert Brief by pr_id (overwrite — AC-11)
        API-->>UI: Brief
    else failure / invalid
        LLM-->>API: error / schema-invalid
        API-->>UI: error (prior cached brief untouched — AC-8)
    end
```

### Contracts (grounded in existing code)

- **`Brief`** (NEW — does not exist today): `{ what: string; why: string;
  risk_level: RiskSeverity; risks: Risk[]; review_focus: ReviewFocusItem[] }`,
  where `ReviewFocusItem = { file: string; reason: string }`. `Risk` and
  `RiskSeverity` are reused **verbatim** from `contracts/brief.ts:55-65`. The new
  contract must be added to BOTH vendored `shared` copies by hand
  (`server/src/vendor/shared/**` covers server + reviewer-core; `client/src/vendor/shared/**`
  is the client copy) and re-exported for the client via `client/src/lib/types.ts`
  (which already re-exports `PrBrief`/`Intent`/`BlastRadius`). Exact field
  nullability/ordering is an implementation-planner decision.
- **`pr_brief` table** (existing, `schema/reviews.ts:57-62`): `{ pr_id (PK), json
  (jsonb) }`, currently written by nothing. Reused as the `Brief` cache — store
  the `Brief` JSON in `json`, upsert on `pr_id` (mirrors `upsertIntent`'s
  `onConflictDoUpdate`). Whether to add provenance columns (model / cost /
  input-size, à la `onboarding.sourceSha`/`costCents`) or keep them log-only is
  an implementation-planner decision; see `[NEEDS CLARIFICATION]`.
- **`risk_brief` `FeatureModelId`** (existing, `contracts/platform.ts:67-73`):
  reused as the brief's model. **Its current default is `openai/gpt-4.1`, which
  is NOT a flash/cheap model** — inconsistent with the "nearly free" framing and
  with the `onboarding`/`conventions`/`blast_summary` precedent of defaulting new
  compose features to `openrouter` flash SKUs. This spec **recommends** correcting
  the `risk_brief` default to a flash model; see `[NEEDS CLARIFICATION]`.
- **Reused read surfaces** (all existing, unchanged): `GET /pulls/:id/intent`
  data (or `ReviewRepository.getIntent`), the `blast` service's `BlastRadius`,
  the `smart-diff` service's `SmartDiff`, the GitHub adapter's best-effort
  linked-issue resolution (as `intent/service.ts` already calls it), and
  `ContextService` for attached specs.
- **New server routes** (mirroring `intent/routes.ts`): `GET /pulls/:id/brief` →
  `Brief | null`; `POST /pulls/:id/brief` → runs Generate/Regenerate, rate-limited
  (AC-13). Both workspace-scoped via the existing `getContext` guard.
- **Client** — a new `PrBriefCard` under
  `client/.../pulls/[number]/_components/`, a `usePrBrief` / regenerate hook pair
  (mirroring `hooks/intent.ts`), mounted in `OverviewTab`, reusing the existing
  `onOpenInDiff` prop already threaded to that tab.

## Inputs (provenance)

- Stored Intent: **[reused: `intent` module / `pr_intent` — L03, implemented]**.
- Blast-radius facts: **[reused: `blast` module / repo-intel — L04, implemented]**.
- Smart-Diff group counts + changed-file paths: **[reused: `smart-diff` module —
  L03, implemented]**.
- Linked issue: **[reused: GitHub adapter best-effort resolution]** — degrades
  silently (AC-3).
- Relevant attached specs: **[reused: `context` module — SPEC-01, implemented]**.
- The composed `Brief` (`what`/`why`/`risk_level`/`risks`/`review_focus`):
  **[new: 1 LLM call per generation]**, via the pre-registered `risk_brief`
  `FeatureModelId` (currently a non-flash default — see Contracts).
- Cache read/write, grounding, input-size measurement, cost/model logging:
  **[deterministic: DB read/write + string checks]** — no model involvement.

## Untrusted inputs

Every substantive input to the single LLM call is external,
attacker-influenceable text:
- **Intent** is derived from the PR title/body (author-controlled).
- **Blast** facts derive from indexed code an attacker can commit.
- **Smart-Diff** paths are GitHub-supplied file paths.
- **The linked issue** is arbitrary issue text.
- **Attached specs** are markdown anyone who can land a commit under
  `specs/`/`docs/`/`insights/` controls (the exact surface SPEC-01-project-context
  already treats as untrusted).

This is a **prompt-injection surface**, not merely input validation: a crafted
PR body, issue, or spec could try to make the model emit a misleading *why*, a
falsely-low `risk_level`, or a `review_focus` steering the reviewer away from the
dangerous file. Because the *output* is a human-facing summary a reviewer may act
on, the consequence is more direct than an internal enrichment string.

Mitigation (grounded in existing behaviour; consult the `security` skill):
- Every gathered raw-text fact (intent summary, issue text, spec bodies, blast
  summary) MUST be wrapped as untrusted data in the assembled prompt, consistent
  with how `reviewer-core`/`context` already wrap untrusted blocks
  (`wrapUntrusted` + the trusted `INJECTION_GUARD` that declares
  `<untrusted>…</untrusted>` content is DATA, never instructions). Do not add
  denylist/keyword scanning of the text.
- AC-9's file-reference grounding is a **code-side backstop** against path
  hallucination/injection, not just a prompt instruction: `risks[].file_refs` and
  `review_focus[].file` are validated against the PR's real changed-file set and
  dropped otherwise.
- The brief is read-only text; this feature introduces no mechanism that
  executes, schedules, or auto-runs anything derived from a generated field, no
  new secrets, no new write scope, and no new outbound calls beyond the already-
  configured LLM provider.

## [NEEDS CLARIFICATION]

- **`review_focus` shape.** Defaulting to a richer `{file, reason}` item (AC-7)
  rather than a bare `string[]`, because the assignment requires each item to
  deep-link to a real file and `onOpenInDiff` needs a file path. Confirm the
  richer shape (and whether an optional `line` should be added to jump to a
  specific line, not just the file top). Non-blocking; defaulting to `{file,
  reason}`, no line.
- **`risk_level` derivation.** Defaulting to model-produced as part of the single
  structured call (simplest, matches "one call composes everything"). Alternative:
  derive it deterministically as `max(severity)` over the grounded `risks[]` for
  guaranteed consistency (and force `low` when `risks[]` is empty). Confirm which.
  Non-blocking; defaulting to model-produced with the empty-risks case left valid
  (AC-10).
- **Cache storage details.** Defaulting to reusing the existing `pr_brief` table's
  generic `json` column (overwrite-on-regenerate). Confirm (a) that reusing the
  `pr_brief`-named table for the `Brief` (not `PrBrief`) type is acceptable given
  the naming collision, and (b) whether to add provenance columns
  (`model`/`cost`/`input_size`, à la `onboarding`) or keep provenance log-only.
  Non-blocking; defaulting to reuse + log-only.
- **`PrBriefCard` mount position.** Defaulting to the **top of the Overview tab,
  above `IntentCard`**, since the brief is the executive "what/why/risk" summary a
  reviewer wants first. Confirm vs. placing it below `BlastRadiusCard`. Either way
  it does not modify the existing cards (AC-18). Non-blocking.
- **"Relevant specs" selection + cap.** The `context` module attaches specs
  per-agent/per-skill, not per-PR — there is no built-in "specs relevant to THIS
  PR" notion. Defaulting to a **bounded** set (e.g. specs attached to the
  reviewer agent(s) configured for this PR, or a capped slice of the repo's
  discovered docs) to protect the ≤ 8K budget, rather than injecting all
  discovered docs. Confirm the exact source and cap. Non-blocking; defaulting to
  a bounded/capped set.
- **`risk_brief` model default.** Recommending the default be corrected from
  `openai/gpt-4.1` to a flash SKU (e.g. `openrouter`/`deepseek-v4-flash`, matching
  `onboarding`/`conventions`/`blast_summary`) to honour "nearly free." Confirm
  whether to change it in this feature or leave it and let the workspace override.
  Non-blocking; recommending the flash correction.
