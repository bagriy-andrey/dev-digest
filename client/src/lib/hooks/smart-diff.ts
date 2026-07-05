/* hooks/smart-diff.ts — React Query hook for the Smart Diff grouping
   (GET /pulls/:id/smart-diff). Classification/grouping is review-independent
   (an unreviewed PR still returns valid groups); the `finding_lines` overlay
   changes only when a review completes — callers should invalidate
   ["smart-diff", prId] alongside ["reviews", prId] when a run finishes. */
"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import type { SmartDiff } from "../types";

export function useSmartDiff(prId: string | null | undefined) {
  return useQuery({
    queryKey: ["smart-diff", prId],
    queryFn: () => api.get<SmartDiff>(`/pulls/${prId}/smart-diff`),
    enabled: !!prId,
  });
}
