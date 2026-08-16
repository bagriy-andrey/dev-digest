/* ExportWizard/constants.ts — static option lists for the four wizard steps.
   No copy here — every label resolves through `useTranslations("ci")` at the
   call site; these are just the (value, icon, translation-key-suffix) tuples
   the steps iterate over. */
import type { IconName } from "@devdigest/ui";
import type { CiTarget } from "@/lib/types";

export const WIZARD_STEP_KEYS = ["target", "preview", "configure", "install"] as const;
export type WizardStepKey = (typeof WIZARD_STEP_KEYS)[number];

export const TARGET_OPTIONS: {
  value: CiTarget;
  icon: IconName;
  recommended?: boolean;
}[] = [
  { value: "gha", icon: "GitBranch", recommended: true },
  { value: "circle", icon: "Workflow" },
  { value: "jenkins", icon: "Wrench" },
  { value: "cli", icon: "Code" },
];

/** The only target the server actually accepts (D-plan §Assumption 2). */
export const SUPPORTED_TARGET: CiTarget = "gha";

export const DEFAULT_BASE = "main";

/** `opened`+`synchronize` are checked by default; `reopened` is optional —
 *  mirrors `sanitizeTriggers`'s `DEFAULT_TRIGGERS` on the server (D9). */
export const TRIGGER_OPTIONS: { value: "opened" | "synchronize" | "reopened"; defaultChecked: boolean }[] = [
  { value: "opened", defaultChecked: true },
  { value: "synchronize", defaultChecked: true },
  { value: "reopened", defaultChecked: false },
];

export const DEFAULT_TRIGGERS: string[] = TRIGGER_OPTIONS.filter((t) => t.defaultChecked).map(
  (t) => t.value,
);

export const POST_AS_OPTIONS = ["github_review", "pr_comment", "none"] as const;
export type PostAsOption = (typeof POST_AS_OPTIONS)[number];
export const DEFAULT_POST_AS: PostAsOption = "github_review";

/** Static, informational-only secrets table (AC-31) — no live check against
 *  the target repo's actual Actions secrets. */
export const SECRET_ROWS: { key: string; noteKey: string }[] = [
  { key: "OPENROUTER_API_KEY", noteKey: "exportWizard.secretsTable.openrouterManual" },
  { key: "GITHUB_TOKEN", noteKey: "exportWizard.secretsTable.githubTokenAuto" },
];

export const DOCS_URL = "https://github.com/devdigest/docs/blob/main/ci-export.md";
