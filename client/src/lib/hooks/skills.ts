/* hooks/skills.ts — React Query hooks for the A1 Skills Lab. */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, API_BASE } from "../api";
import type { Skill, AgentSkillLink, SkillType, SkillSource } from "@devdigest/shared";

// ---- types ----------------------------------------------------------------

export interface SkillStats {
  agentsCount: number;
  pullFrequencyPct: number;
  acceptRatePct: number;
  findings30d: number;
  agentsUsing: { id: string; name: string }[];
  findingsByCategory: { category: string; count: number }[];
}

export interface SkillVersion {
  skill_id: string;
  version: number;
  body: string;
  created_at: string;
}

export interface ImportPreview {
  name: string;
  body: string;
  source: SkillSource;
}

export interface CommunitySkill {
  name: string;
  description: string;
  type: string;
  stars: number;
}

export interface CreateSkillInput {
  name: string;
  description?: string;
  type: SkillType;
  body: string;
  source?: SkillSource;
  enabled?: boolean;
}

export interface UpdateSkillInput {
  name?: string;
  description?: string;
  type?: SkillType;
  body?: string;
  enabled?: boolean;
}

// ---- query hooks ----------------------------------------------------------

export function useSkills() {
  return useQuery({
    queryKey: ["skills"],
    queryFn: () => api.get<Skill[]>("/skills"),
  });
}

export function useSkill(id: string | null | undefined) {
  return useQuery({
    queryKey: ["skill", id],
    queryFn: () => api.get<Skill>(`/skills/${id}`),
    enabled: !!id,
  });
}

export function useSkillStats(id: string | null | undefined) {
  return useQuery({
    queryKey: ["skill-stats", id],
    queryFn: () => api.get<SkillStats>(`/skills/${id}/stats`),
    enabled: !!id,
  });
}

export function useSkillVersions(id: string | null | undefined) {
  return useQuery({
    queryKey: ["skill-versions", id],
    queryFn: () => api.get<SkillVersion[]>(`/skills/${id}/versions`),
    enabled: !!id,
  });
}

export function useCommunitySkills() {
  return useQuery({
    queryKey: ["skills-community"],
    queryFn: () => api.get<CommunitySkill[]>("/skills/community"),
    staleTime: 5 * 60_000,
  });
}

export function useAgentSkills(agentId: string | null | undefined) {
  return useQuery({
    queryKey: ["agent-skills", agentId],
    queryFn: () => api.get<AgentSkillLink[]>(`/agents/${agentId}/skills`),
    enabled: !!agentId,
  });
}

// ---- mutation hooks -------------------------------------------------------

export function useCreateSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateSkillInput) => api.post<Skill>("/skills", input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["skills"] }),
  });
}

export function useUpdateSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateSkillInput }) =>
      api.put<Skill>(`/skills/${id}`, patch),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["skills"] });
      qc.setQueryData(["skill", data.id], data);
      qc.invalidateQueries({ queryKey: ["skill-versions", data.id] });
    },
  });
}

export function useDeleteSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del<{ ok: boolean }>(`/skills/${id}`),
    onSuccess: (_d, id) => {
      qc.invalidateQueries({ queryKey: ["skills"] });
      qc.removeQueries({ queryKey: ["skill", id] });
    },
  });
}

export function useSetAgentSkills() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ agentId, skillIds }: { agentId: string; skillIds: string[] }) =>
      api.post<AgentSkillLink[]>(`/agents/${agentId}/skills`, { skill_ids: skillIds }),
    onSuccess: (_d, { agentId }) =>
      qc.invalidateQueries({ queryKey: ["agent-skills", agentId] }),
  });
}

export function useLinkAgentSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      agentId,
      skillId,
      order,
      enabled,
    }: {
      agentId: string;
      skillId: string;
      order?: number;
      enabled?: boolean;
    }) =>
      api.post<AgentSkillLink[]>(`/agents/${agentId}/skills`, { skill_id: skillId, order, enabled }),
    onSuccess: (_d, { agentId }) =>
      qc.invalidateQueries({ queryKey: ["agent-skills", agentId] }),
  });
}

export function useImportSkillFile() {
  return useMutation({
    mutationFn: async (file: File): Promise<ImportPreview> => {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`${API_BASE}/skills/import/file`, {
        method: "POST",
        body: form,
      });
      if (!res.ok) throw new Error(`Import failed: ${res.status}`);
      return res.json() as Promise<ImportPreview>;
    },
  });
}

export function useImportSkillUrl() {
  return useMutation({
    mutationFn: (url: string): Promise<ImportPreview> =>
      api.post<ImportPreview>("/skills/import/url", { url }),
  });
}
