/* hooks/context.ts — React Query hooks for Project Context: on-demand file
   preview, and agent/skill doc attachments (mirrors hooks/skills.ts's
   attach/reorder shape for agent_skills, applied to context docs). */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { ContextAttachment, ContextFileContent } from "../types";

// ---- Preview (GET /repos/:id/context/file?path=, on-demand) ----
export function useContextFile(repoId: string | null | undefined, path: string | null | undefined) {
  return useQuery({
    queryKey: ["context-file", repoId, path],
    queryFn: () =>
      api.get<ContextFileContent>(
        `/repos/${repoId}/context/file?path=${encodeURIComponent(path!)}`
      ),
    enabled: !!repoId && !!path,
  });
}

// ---- Agent context attachments (GET/PUT /agents/:id/context) ----
export function useAgentContextDocs(agentId: string | null | undefined) {
  return useQuery({
    queryKey: ["agent-context", agentId],
    queryFn: () => api.get<ContextAttachment[]>(`/agents/${agentId}/context`),
    enabled: !!agentId,
  });
}

export function useSetAgentContextDocs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      agentId,
      paths,
    }: {
      agentId: string;
      /** Active repo whose Project Context metrics ("used by N agents" /
       *  coverage) need invalidating — not sent to the API (the route is
       *  agent-scoped), only used for the client-side query key below. */
      repoId: string;
      paths: string[];
    }) => api.put<ContextAttachment[]>(`/agents/${agentId}/context`, { paths }),
    onSuccess: (_d, { agentId, repoId }) => {
      qc.invalidateQueries({ queryKey: ["agent-context", agentId] });
      // Attaching/detaching a doc changes its "used by N agents" / coverage
      // metrics on the Project Context page for the active repo.
      qc.invalidateQueries({ queryKey: ["context", repoId] });
    },
  });
}

// ---- Skill context attachments (GET/PUT /skills/:id/context) ----
export function useSkillContextDocs(skillId: string | null | undefined) {
  return useQuery({
    queryKey: ["skill-context", skillId],
    queryFn: () => api.get<ContextAttachment[]>(`/skills/${skillId}/context`),
    enabled: !!skillId,
  });
}

export function useSetSkillContextDocs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      skillId,
      paths,
    }: {
      skillId: string;
      /** Active repo whose Project Context metrics need invalidating — not
       *  sent to the API (the route is skill-scoped), client-side only. */
      repoId: string;
      paths: string[];
    }) => api.put<ContextAttachment[]>(`/skills/${skillId}/context`, { paths }),
    onSuccess: (_d, { skillId, repoId }) => {
      qc.invalidateQueries({ queryKey: ["skill-context", skillId] });
      // A skill's docs are inherited by every agent that links it, so its
      // coverage metrics change too.
      qc.invalidateQueries({ queryKey: ["context", repoId] });
    },
  });
}
