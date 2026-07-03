"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { ConventionCandidate } from "@devdigest/shared";

export type { ConventionCandidate };

export interface CreateSkillFromConventionsInput {
  repoId: string;
  name: string;
  description: string;
  candidateIds: string[];
}

export const conventionsKeys = {
  all: ["conventions"] as const,
  byRepo: (repoId: string) => ["conventions", repoId] as const,
};

export function useConventionCandidates(repoId: string | null | undefined) {
  return useQuery({
    queryKey: conventionsKeys.byRepo(repoId ?? ""),
    queryFn: () => api.get<ConventionCandidate[]>(`/repos/${repoId}/conventions`),
    enabled: !!repoId,
  });
}

export function useRunExtractor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (repoId: string) =>
      api.post<ConventionCandidate[]>(`/repos/${repoId}/conventions/extract`),
    onSuccess: (data, repoId) => {
      qc.setQueryData(conventionsKeys.byRepo(repoId), data);
    },
  });
}

export function useCreateSkillFromConventions() {
  return useMutation({
    mutationFn: ({ repoId, name, description, candidateIds }: CreateSkillFromConventionsInput) =>
      api.post<{ skillId: string }>(`/repos/${repoId}/conventions/to-skill`, {
        name,
        description,
        candidateIds,
      }),
  });
}
