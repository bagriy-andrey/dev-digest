/* hooks/blast.ts — React Query hooks for the Blast Radius map
   (GET /pulls/:id/blast) and its OPTIONAL one-paragraph LLM summary
   (POST /pulls/:id/blast/summarize). Mirrors hooks/intent.ts's shape. */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { BlastRadiusResult } from "../types";

export function usePrBlast(prId: string | null) {
  return useQuery({
    queryKey: ["pr-blast", prId],
    queryFn: () => api.get<BlastRadiusResult>(`/pulls/${prId}/blast`),
    enabled: !!prId,
  });
}

/** OPTIONAL step — never called automatically; manual "Summarize" action only. */
export function useSummarizeBlast(prId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<BlastRadiusResult>(`/pulls/${prId}/blast/summarize`),
    onSuccess: (data) => {
      qc.setQueryData(["pr-blast", prId], data);
    },
  });
}
