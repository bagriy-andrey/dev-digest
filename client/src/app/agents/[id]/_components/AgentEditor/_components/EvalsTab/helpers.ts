/* Pure helpers for the Evals tab + case editor — no I/O, no React. */
import { EvalExpectations } from "@devdigest/shared";
import type { Category, Severity } from "@devdigest/ui";
import type { EvalExpectation, EvalRunDetail, EvalRunRecord } from "@/lib/types";

/**
 * Best-effort parse of a case's `expected_output` (wire type `z.unknown()`)
 * into `EvalExpectation[]`. Unlike the server's `parseExpectations`
 * (`modules/evals/expectations.ts`), this NEVER throws — it only feeds
 * read-only summaries (row tags, expected counts), so anything that doesn't
 * validate degrades to "no expectations" rather than breaking the row.
 */
export function parseExpectations(raw: unknown): EvalExpectation[] {
  if (raw === null || raw === undefined) return [];
  const result = EvalExpectations.safeParse(raw);
  return result.success ? result.data : [];
}

/** Number of `must_find` expectations (an absent `kind` defaults to
 *  `must_find` — mirrors `scorer.ts::scoreCase`). This is the case's
 *  "expected N" figure, independent of whether it has ever been run. */
export function mustFindCount(expectations: EvalExpectation[]): number {
  return expectations.filter((e) => (e.kind ?? "must_find") === "must_find").length;
}

/** Unique severities across a case's expectations, in first-seen order —
 *  feeds the case row's severity tags. */
export function uniqueSeverities(expectations: EvalExpectation[]): Severity[] {
  const seen = new Set<Severity>();
  const out: Severity[] = [];
  for (const e of expectations) {
    if (e.severity && !seen.has(e.severity)) {
      seen.add(e.severity);
      out.push(e.severity);
    }
  }
  return out;
}

/** Unique categories across a case's expectations, in first-seen order —
 *  feeds the case row's category tags. */
export function uniqueCategories(expectations: EvalExpectation[]): Category[] {
  const seen = new Set<Category>();
  const out: Category[] = [];
  for (const e of expectations) {
    if (e.category && !seen.has(e.category)) {
      seen.add(e.category);
      out.push(e.category);
    }
  }
  return out;
}

/**
 * Structural narrow of a run's `actual_output` (wire type `z.unknown()`)
 * into the server-written `EvalRunDetail` shape (plan D3). This is an API
 * RESPONSE, not user input — per this repo's convention the client never
 * re-validates API responses with zod (`client/insights.md`), so this is a
 * lightweight shape check, not a `safeParse`.
 */
export function asRunDetail(actual: unknown): EvalRunDetail | null {
  if (!actual || typeof actual !== "object") return null;
  const counts = (actual as Partial<EvalRunDetail>).counts;
  if (!counts || typeof counts.must_find !== "number" || typeof counts.actual !== "number") {
    return null;
  }
  return actual as EvalRunDetail;
}

/** Most recent run (by `ran_at`) for a given case id, or `null` if the case
 *  has never been run. `runs` is the agent's full run list (the eval-runs
 *  route has no `case_id` filter), so this groups client-side. */
export function latestRunForCase(
  runs: EvalRunRecord[] | undefined,
  caseId: string,
): EvalRunRecord | null {
  const forCase = (runs ?? []).filter((r) => r.case_id === caseId);
  if (forCase.length === 0) return null;
  return [...forCase].sort((a, b) => b.ran_at.localeCompare(a.ran_at))[0] ?? null;
}

export interface ExpectedOutputValidation {
  valid: boolean;
  parsed?: EvalExpectation[];
  error?: string;
}

/**
 * Validates the case editor's hand-edited `expected_output` JSON text against
 * the expectation contract (mirrors `modules/evals/expectations.ts::parseExpectations`,
 * client-side, for the live validity indicator — AC-8's UI half). Unlike the
 * row-summary parser above, this DOES surface the first error, since it's
 * driving a save-blocking indicator, not a passive summary.
 */
export function validateExpectedOutputJson(text: string): ExpectedOutputValidation {
  let json: unknown;
  try {
    json = text.trim() === "" ? [] : JSON.parse(text);
  } catch {
    return { valid: false, error: "not valid JSON" };
  }
  const result = EvalExpectations.safeParse(json);
  if (!result.success) {
    const [firstIssue] = result.error.issues;
    const path = firstIssue?.path?.join(".") || "(entry)";
    return { valid: false, error: `${path}: ${firstIssue?.message ?? "invalid entry"}` };
  }
  return { valid: true, parsed: result.data };
}
