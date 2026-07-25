/* hooks/onboarding.ts — React Query hooks for the Onboarding Tour
   (GET /repos/:id/onboarding, POST /repos/:id/onboarding/generate).
   The generate mutation serves both "Generate" and "Regenerate" (AC-20) —
   the client screen decides which label to show based on whether
   `onboarding` is null. */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { OnboardingDoc } from "../types";

export function useOnboarding(repoId: string) {
  return useQuery({
    queryKey: ["onboarding", repoId],
    queryFn: () => api.get<OnboardingDoc>(`/repos/${repoId}/onboarding`),
  });
}

export function useGenerateOnboarding(repoId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api.post<OnboardingDoc>(`/repos/${repoId}/onboarding/generate`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["onboarding", repoId] });
    },
  });
}
