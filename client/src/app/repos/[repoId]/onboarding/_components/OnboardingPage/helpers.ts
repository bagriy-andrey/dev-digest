/**
 * Staleness compare (AC-14): a document is stale when its persisted
 * generation-time index SHA differs from the repo's *current* index SHA.
 * Pure client-side comparison of two already-fetched values — no new
 * endpoint. Either side being unknown (still loading / repo never indexed)
 * yields "not stale" rather than a false-positive indicator.
 */
export function isStale(
  sourceSha: string | null | undefined,
  lastIndexedSha: string | null | undefined,
): boolean {
  return sourceSha != null && lastIndexedSha != null && sourceSha !== lastIndexedSha;
}
