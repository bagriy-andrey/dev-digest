/* hooks/intent.ts — React Query hooks for the Intent Layer: read/recalculate the
   stored per-PR intent, and read/set the per-repo classifier model override. */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { Intent, Provider, RepoFeatureModel } from "../types";

// ---- Stored PR intent (GET /pulls/:id/intent, POST /pulls/:id/intent/recalculate) ----
export function usePrIntent(prId: string | null) {
  return useQuery({
    queryKey: ["pr-intent", prId],
    queryFn: () => api.get<Intent | null>(`/pulls/${prId}/intent`),
    enabled: !!prId,
  });
}

export function useRecalculateIntent(prId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<Intent>(`/pulls/${prId}/intent/recalculate`),
    onSuccess: (data) => {
      qc.setQueryData(["pr-intent", prId], data);
    },
  });
}

// ---- Per-repo classifier model override (GET/PUT /repos/:id/intent-model) ----
export function useRepoIntentModel(repoId: string | null) {
  return useQuery({
    queryKey: ["repo-intent-model", repoId],
    queryFn: () => api.get<RepoFeatureModel | null>(`/repos/${repoId}/intent-model`),
    enabled: !!repoId,
  });
}

export function useSetRepoIntentModel(repoId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { provider: Provider; model: string }) =>
      api.put<RepoFeatureModel>(`/repos/${repoId}/intent-model`, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["repo-intent-model", repoId] });
    },
  });
}
