import type { FindingRecord, ReviewRecord } from "@/lib/types";

/** `AgentColumnFinding` deliberately doesn't carry `confidence`/`rationale`/
 *  `suggestion` (the contract is not widened) — look the full persisted
 *  `FindingRecord` up by id from `usePrReviews(prId)` instead. */
export function findFindingRecord(
  reviews: ReviewRecord[] | undefined,
  findingId: string | null
): FindingRecord | undefined {
  if (!findingId) return undefined;
  for (const review of reviews ?? []) {
    const match = review.findings.find((f) => f.id === findingId);
    if (match) return match;
  }
  return undefined;
}
