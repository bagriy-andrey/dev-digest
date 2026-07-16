/* hooks/brief.ts — React Query hooks for the PR Why + Risk Brief: read the
   cached per-PR brief, and generate/regenerate it (single mutation serves
   both — the card decides the button label from whether a brief exists). */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { Brief } from "../types";

// ---- Stored PR brief (GET /pulls/:id/brief, POST /pulls/:id/brief) ----
export function usePrBrief(prId: string | null) {
  return useQuery({
    queryKey: ["pr-brief", prId],
    queryFn: () => api.get<Brief | null>(`/pulls/${prId}/brief`),
    enabled: !!prId,
  });
}

export function useGenerateBrief(prId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<Brief>(`/pulls/${prId}/brief`),
    onSuccess: (data) => {
      qc.setQueryData(["pr-brief", prId], data);
    },
  });
}
