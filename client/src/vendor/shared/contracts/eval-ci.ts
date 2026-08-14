import { z } from 'zod';
import { Verdict, Finding, Severity, FindingCategory } from './findings.js';
import { EvalRun, EvalOwnerKind, Conformance, Provider } from './knowledge.js';

/**
 * A4 — Eval / CI / Compose / Conformance API contracts (L06).
 *
 * These EXTEND the barrel; they do not modify existing contract files. The base
 * `EvalRun`, `EvalCase`, `EvalOwnerKind`, `Conformance` live in `knowledge.ts`;
 * here we add the *API-facing* request/response shapes (records persisted in
 * `eval_runs`, `composed_reviews`, `ci_installations`, `ci_runs`,
 * `conformance_checks`) plus the eval-dashboard aggregate.
 */

// ===========================================================================
// Eval — case input + persisted run record + dashboard
// ===========================================================================

/** Create/update payload for an eval case (id + owner resolved by the route). */
export const EvalCaseInput = z.object({
  owner_kind: EvalOwnerKind,
  owner_id: z.string(),
  name: z.string().min(1),
  input_diff: z.string().default(''),
  input_files: z.unknown().nullish(),
  input_meta: z.unknown().nullish(),
  expected_output: z.unknown(),
  notes: z.string().nullish(),
});
export type EvalCaseInput = z.infer<typeof EvalCaseInput>;

// ---------------------------------------------------------------------------
// NEW-1 — the typed shape of the (still `z.unknown()`) `expected_output`
// entries. Each entry is finding-shaped plus a discriminator (`kind`); absent
// `kind` defaults to `must_find`. Severity/category/title are informational
// only and never participate in matching (AC-14).
// ---------------------------------------------------------------------------

export const EvalExpectationKind = z.enum(['must_find', 'must_not_flag']);
export type EvalExpectationKind = z.infer<typeof EvalExpectationKind>;

export const EvalExpectation = z.object({
  kind: EvalExpectationKind.default('must_find'),
  file: z.string().min(1),
  start_line: z.number().int(),
  end_line: z.number().int().nullish(),
  severity: Severity.nullish(),
  category: FindingCategory.nullish(),
  title: z.string().nullish(),
});
export type EvalExpectation = z.infer<typeof EvalExpectation>;

export const EvalExpectations = z.array(EvalExpectation);
export type EvalExpectations = z.infer<typeof EvalExpectations>;

// ---------------------------------------------------------------------------
// NEW-5 — the typed shape the server writes into `EvalRunRecord.actual_output`
// (D3: the contract field itself stays `z.unknown()` for backward-compat;
// this is what a fresh run row's payload actually looks like). Raw counts
// (not just percentages) let a batch aggregate be reconstructed from its
// per-case rows alone (micro-averaging needs pooled numerators/denominators).
// ---------------------------------------------------------------------------

export const EvalRunCounts = z.object({
  must_find: z.number().int(),
  matched: z.number().int(),
  actual: z.number().int(),
  noise: z.number().int(),
  dropped: z.number().int(),
});
export type EvalRunCounts = z.infer<typeof EvalRunCounts>;

export const EvalRunDetail = z.object({
  findings: z.array(Finding).default([]),
  counts: EvalRunCounts,
  model: z.string().nullish(),
  error: z.string().nullable().default(null),
});
export type EvalRunDetail = z.infer<typeof EvalRunDetail>;

/** A persisted eval run row (one execution of a case), returned by the API. */
export const EvalRunRecord = z.object({
  id: z.string(),
  case_id: z.string(),
  case_name: z.string().nullish(),
  ran_at: z.string(),
  actual_output: z.unknown(),
  pass: z.boolean().nullable(),
  recall: z.number().nullable(),
  precision: z.number().nullable(),
  citation_accuracy: z.number().nullable(),
  duration_ms: z.number().int().nullable(),
  cost_usd: z.number().nullable(),
  // EXT-1 — the batch this run belongs to (nullable: pre-extension rows).
  batch_id: z.string().nullable(),
  // EXT-2 — the agent's `version` at execution time (nullable: pre-extension rows).
  agent_version: z.number().int().nullable(),
});
export type EvalRunRecord = z.infer<typeof EvalRunRecord>;

/** Result of running a single case: the metrics (EvalRun) + the persisted row id. */
export const EvalRunResult = z.object({
  run_id: z.string(),
  case_id: z.string(),
  result: EvalRun,
});
export type EvalRunResult = z.infer<typeof EvalRunResult>;

/** One point on the dashboard trend (per run, chronological). */
export const EvalTrendPoint = z.object({
  ran_at: z.string(),
  recall: z.number(),
  precision: z.number(),
  citation_accuracy: z.number(),
  pass_rate: z.number(),
  cost_usd: z.number().nullable(),
});
export type EvalTrendPoint = z.infer<typeof EvalTrendPoint>;

// ---------------------------------------------------------------------------
// NEW-2 — a batch: one execution of an agent's whole case set.
// ---------------------------------------------------------------------------

export const EvalBatchStatus = z.enum(['running', 'complete']);
export type EvalBatchStatus = z.infer<typeof EvalBatchStatus>;

export const EvalBatchSummary = z.object({
  batch_id: z.string(),
  agent_id: z.string(),
  agent_name: z.string(),
  agent_version: z.number().int().nullable(),
  ran_at: z.string(),
  cases_total: z.number().int(),
  cases_passed: z.number().int(),
  recall: z.number(),
  precision: z.number(),
  citation_accuracy: z.number(),
  // D1/AC-18 — true when that metric's denominator was zero (stored value is
  // then 1, but the UI must render "not applicable", never "100%").
  recall_na: z.boolean(),
  precision_na: z.boolean(),
  citation_accuracy_na: z.boolean(),
  cost_usd: z.number().nullable(),
  duration_ms: z.number().int(),
  status: EvalBatchStatus,
});
export type EvalBatchSummary = z.infer<typeof EvalBatchSummary>;

/** Aggregate dashboard for an owner (agent/skill) or the whole workspace. */
export const EvalDashboard = z.object({
  owner_kind: EvalOwnerKind.nullable(),
  owner_id: z.string().nullable(),
  cases_total: z.number().int(),
  current: z.object({
    recall: z.number(),
    precision: z.number(),
    citation_accuracy: z.number(),
    traces_passed: z.number().int(),
    traces_total: z.number().int(),
    cost_usd: z.number().nullable(),
  }),
  delta: z.object({
    recall: z.number(),
    precision: z.number(),
    citation_accuracy: z.number(),
  }),
  trend: z.array(EvalTrendPoint),
  recent_runs: z.array(EvalRunRecord),
  // EXT-3 — per-batch history for the per-agent Recent-runs table (AC-33).
  recent_batches: z.array(EvalBatchSummary).default([]),
  alert: z.string().nullable(),
});
export type EvalDashboard = z.infer<typeof EvalDashboard>;

// ---------------------------------------------------------------------------
// NEW-3 — comparing two batches of the same agent.
// ---------------------------------------------------------------------------

export const EvalCompare = z.object({
  agent_id: z.string(),
  a: EvalBatchSummary,
  b: EvalBatchSummary,
  delta: z.object({
    recall: z.number(),
    precision: z.number(),
    citation_accuracy: z.number(),
    cost_usd: z.number().nullable(),
  }),
  // null ⟺ that side's `agent_version` is null (AC-28).
  system_prompt_a: z.string().nullable(),
  system_prompt_b: z.string().nullable(),
  // AC-29 — cases present in only one of the two compared batches.
  cases_only_in_a: z.number().int(),
  cases_only_in_b: z.number().int(),
});
export type EvalCompare = z.infer<typeof EvalCompare>;

// ---------------------------------------------------------------------------
// NEW-4 — the workspace-wide eval dashboard (one row per enabled agent).
// ---------------------------------------------------------------------------

export const EvalAgentRow = z.object({
  agent_id: z.string(),
  agent_name: z.string(),
  provider: Provider,
  model: z.string(),
  enabled: z.boolean(),
  cases_total: z.number().int(),
  last_batch: EvalBatchSummary.nullable(),
  recall_trend: z.array(z.number()),
});
export type EvalAgentRow = z.infer<typeof EvalAgentRow>;

export const EvalWorkspaceDashboard = z.object({
  workspace: EvalDashboard,
  agents: z.array(EvalAgentRow),
});
export type EvalWorkspaceDashboard = z.infer<typeof EvalWorkspaceDashboard>;

// ---------------------------------------------------------------------------
// NEW-6 — the immediate (fire-and-forget) response of triggering a batch.
// ---------------------------------------------------------------------------

export const EvalBatchStart = z.object({
  batch_id: z.string().nullable(),
  cases_total: z.number().int(),
});
export type EvalBatchStart = z.infer<typeof EvalBatchStart>;

export const EvalBatchStartAll = z.object({
  batches: z.array(
    z.object({
      agent_id: z.string(),
      batch_id: z.string().nullable(),
      cases_total: z.number().int(),
    }),
  ),
});
export type EvalBatchStartAll = z.infer<typeof EvalBatchStartAll>;

// ===========================================================================
// Compose Review
// ===========================================================================

export const ComposeReviewInput = z.object({
  /** Finding ids to fold into the draft (optional — body may be hand-written). */
  finding_ids: z.array(z.string()).default([]),
  /** Editable markdown body. If omitted, the server composes one from findings. */
  body: z.string().nullish(),
  verdict: Verdict.default('comment'),
  /** When true, attach selected findings as inline comments (path+line+body). */
  inline_comments: z.boolean().default(false),
});
export type ComposeReviewInput = z.infer<typeof ComposeReviewInput>;
/** Caller-facing input type — `.default()` fields stay optional (web hooks). */
export type ComposeReviewInputBody = z.input<typeof ComposeReviewInput>;

/** A persisted composed review (mirrors the `composed_reviews` row). */
export const ComposedReview = z.object({
  id: z.string(),
  pr_id: z.string(),
  body: z.string(),
  verdict: Verdict.nullable(),
  posted_at: z.string().nullable(),
  github_review_id: z.string().nullable(),
});
export type ComposedReview = z.infer<typeof ComposedReview>;

/** A preview (no GitHub side-effect) of what would be posted. */
export const ComposeReviewPreview = z.object({
  body: z.string(),
  verdict: Verdict,
  inline_comments: z.array(
    z.object({ path: z.string(), line: z.number().int(), body: z.string() }),
  ),
});
export type ComposeReviewPreview = z.infer<typeof ComposeReviewPreview>;

// ===========================================================================
// Export-to-CI + CI Runs
// ===========================================================================

export const CiTarget = z.enum(['gha', 'circle', 'jenkins', 'cli']);
export type CiTarget = z.infer<typeof CiTarget>;

/** One generated file in the CI bundle (path + editable contents). */
export const CiFile = z.object({
  path: z.string(),
  contents: z.string(),
  editable: z.boolean().default(true),
});
export type CiFile = z.infer<typeof CiFile>;

/** Request body for `POST /agents/:id/export-ci`. */
export const CiExportInput = z.object({
  repo: z.string().min(1), // "owner/name"
  target: CiTarget.default('gha'),
  /** "open_pr" opens a PR with the files; "files" just returns/persists them. */
  action: z.enum(['open_pr', 'files']).default('open_pr'),
  post_as: z.enum(['github_review', 'pr_comment', 'none']).default('github_review'),
  triggers: z.array(z.string()).default(['opened', 'synchronize', 'reopened']),
  base: z.string().default('main'),
});
export type CiExportInput = z.infer<typeof CiExportInput>;
/** Caller-facing input type — `.default()` fields stay optional (web hooks). */
export type CiExportInputBody = z.input<typeof CiExportInput>;

/** A persisted CI installation (mirrors `ci_installations`). */
export const CiInstallation = z.object({
  id: z.string(),
  agent_id: z.string(),
  repo: z.string(),
  target_type: CiTarget,
  installed_at: z.string(),
});
export type CiInstallation = z.infer<typeof CiInstallation>;

/** Response of `POST /agents/:id/export-ci`. */
export const CiExport = z.object({
  installation: CiInstallation,
  files: z.array(CiFile),
  pr_url: z.string().nullable(),
});
export type CiExport = z.infer<typeof CiExport>;

export const CiRunStatus = z.enum(['succeeded', 'failed', 'no_findings', 'running']);
export type CiRunStatus = z.infer<typeof CiRunStatus>;

/** A CI run row (mirrors `ci_runs`) — ingested from GitHub Actions artifacts. */
export const CiRun = z.object({
  id: z.string(),
  ci_installation_id: z.string().nullable(),
  pr_number: z.number().int().nullable(),
  ran_at: z.string().nullable(),
  status: z.string().nullable(),
  findings_count: z.number().int().nullable(),
  cost_usd: z.number().nullable(),
  github_url: z.string().nullable(),
  source: z.string().nullable(),
  agent: z.string().nullish(),
  duration_s: z.number().nullish(),
});
export type CiRun = z.infer<typeof CiRun>;

/**
 * The artifact shape uploaded by the CI action (`devdigest-result.json`).
 * Ingested back on refresh to populate `ci_runs` (L06).
 */
export const CiResultArtifact = z.object({
  findings_count: z.number().int(),
  critical: z.number().int().nullish(),
  warning: z.number().int().nullish(),
  suggestion: z.number().int().nullish(),
  cost_usd: z.number().nullable(),
  duration_ms: z.number().int().nullish(),
  agent: z.string(),
  version: z.string().nullish(),
  pr_number: z.number().int().nullish(),
});
export type CiResultArtifact = z.infer<typeof CiResultArtifact>;

// ===========================================================================
// Conformance (PRD ↔ PR) — API record (the analysis shape is `Conformance`)
// ===========================================================================

/** Request body for `POST /pulls/:id/conformance`. */
export const ConformanceInput = z.object({
  /** Spec path/id to compare against; if omitted, the first available spec. */
  spec: z.string().nullish(),
  provider: z.enum(['openai', 'anthropic']).nullish(),
  model: z.string().nullish(),
});
export type ConformanceInput = z.infer<typeof ConformanceInput>;

/** A persisted conformance check (mirrors `conformance_checks` + the report). */
export const ConformanceReport = z.object({
  id: z.string(),
  pr_id: z.string(),
  report: Conformance,
});
export type ConformanceReport = z.infer<typeof ConformanceReport>;

// ===========================================================================
// Hooks (Secret-Leak + Phantom-API detectors) — emit grounding-exempt findings
// ===========================================================================

export const HookKind = z.enum(['secret_leak', 'phantom']);
export type HookKind = z.infer<typeof HookKind>;

/** Result of running the built-in detectors over a PR. */
export const HookScanResult = z.object({
  pr_id: z.string(),
  review_id: z.string().nullable(),
  findings: z.array(Finding),
});
export type HookScanResult = z.infer<typeof HookScanResult>;
