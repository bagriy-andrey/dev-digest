/**
 * Shared contract types re-exported from @devdigest/shared (single source of
 * truth). F2 imports these rather than redefining them.
 *
 * F1 (@devdigest/shared) currently exports all the platform/findings/brief/
 * knowledge/trace contracts we need for the scaffolding screens, so there are
 * NO local placeholders required at this time. If a feature agent's contract is
 * not yet exported, add a placeholder below marked
 * `// TODO: reconcile with @devdigest/shared`.
 */
import type { BlastRadius } from "@devdigest/shared";

export type {
  Settings,
  SettingsUpdate,
  ConnTestProvider,
  ConnTestResult,
  SecretsStatus,
  FeatureModelId,
  FeatureModelChoice,
  FeatureModelDef,
  RepoFeatureModel,
  Provider,
  ModelInfo,
  Repo,
  RepoInput,
  PrMeta,
  PrDetail,
  PrFile,
  PrCommit,
  PrReviewComment,
  PrStatus,
  SpecFile,
  IndexStatus,
  ContextDoc,
  ContextIndexStatus,
  ContextAttachment,
  ContextFileContent,
} from "@devdigest/shared";

export type { Review, Finding, Severity, Verdict } from "@devdigest/shared";
export type { PrBrief, SmartDiff, Intent, BlastRadius, Brief, ReviewFocusItem } from "@devdigest/shared";
export type {
  Onboarding,
  OnboardingSection,
  OnboardingLink,
  OnboardingDoc,
} from "@devdigest/shared";
export type { Skill, SkillType, SkillSource, AgentSkillLink } from "@devdigest/shared";
export type {
  EvalCase,
  EvalCaseInput,
  EvalExpectation,
  EvalRunRecord,
  EvalRunDetail,
  EvalBatchSummary,
  EvalCompare,
  EvalDashboard,
  EvalWorkspaceDashboard,
  EvalAgentRow,
  EvalTrendPoint,
  EvalBatchStart,
  EvalBatchStartAll,
  AgentVersion,
} from "@devdigest/shared";

export type {
  CiTarget,
  CiFile,
  CiExportInput,
  CiInstallation,
  CiExport,
  CiRun,
  CiRunStatus,
} from "@devdigest/shared";

/**
 * `GET /pulls/:id/blast`'s actual response shape: the `BlastRadius` contract
 * plus transport-only degraded fields the route adds locally (server never
 * edits the vendored contract for this — see `server/specs/blast-radius.md`).
 * Client doesn't runtime-validate responses (`lib/api.ts` uses plain TS
 * generics, no zod parse), so this is a type-only addition.
 */
export type BlastRadiusResult = BlastRadius & {
  degraded?: boolean;
  degraded_reason?: string | null;
};

/** UI-only view model for a PR list row (derives display fields from PrMeta). */
export interface PrRowView {
  number: number;
  title: string;
  author: string;
  size: "S" | "M" | "L";
  sizeLines: string;
  score: number;
  findings: { CRITICAL: number; WARNING: number; SUGGESTION: number };
  status: "needs_review" | "reviewed" | "stale";
  updated: string;
}
