/* hooks/multi-agent.ts — React Query hooks for the Multi-Agent Review
   feature: the latest group for a PR (with SSE-drop polling fallback), the
   per-agent pre-run estimates, and starting a new group run. */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { AgentRunEstimate, MultiAgentGroupSummary, MultiAgentRun } from "../types";

/** Latest multi-agent group for a PR. Polls every 4s while any column is still
 *  `running` — the belt-and-braces fallback for when SSE drops (AC-43) — and
 *  stops automatically once the group is terminal (AC-44). `null` is a
 *  perfectly normal "no group yet" response (D7), not an error. */
export function useMultiAgentRun(prId: string | null) {
  return useQuery({
    queryKey: ["multi-agent", prId],
    queryFn: () => api.get<MultiAgentRun | null>(`/pulls/${prId}/multi-agent`),
    enabled: !!prId,
    refetchInterval: (query) =>
      (query.state.data?.columns ?? []).some((c) => c.status === "running") ? 4000 : false,
  });
}

/** The most recently started groups anywhere in the workspace, across every
 *  PR (lightweight — no columns/conflicts). Backs `/multi-agent`'s "recent
 *  runs" landing list (entered with no `?pr=`, e.g. from the sidebar), so
 *  reopening the page shows real run history instead of forcing a fresh
 *  Configure-run every time. `[]` is normal — nothing run in this workspace yet. */
export function useRecentMultiAgentGroups(enabled: boolean) {
  return useQuery({
    queryKey: ["multi-agent-recent"],
    queryFn: () => api.get<MultiAgentGroupSummary[]>("/multi-agent/recent"),
    enabled,
  });
}

/** Workspace-wide per-agent pre-run estimates (last 5 completed runs, averaged
 *  server-side). Feeds the checklist rows + the aggregate estimate line. */
export function useAgentRunEstimates() {
  return useQuery({
    queryKey: ["multi-agent-estimates"],
    queryFn: () => api.get<AgentRunEstimate[]>("/multi-agent/estimates"),
  });
}

/** Starts a multi-agent review: one HTTP request carrying every selected
 *  agent id (AC-4). Invalidates the group query plus the existing PR-page
 *  active-runs queries so the rest of the app's SSE/polling wiring keeps
 *  working unchanged. */
export function useStartMultiAgentRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ prId, agentIds }: { prId: string; agentIds: string[] }) =>
      api.post<MultiAgentRun>(`/pulls/${prId}/multi-agent-run`, { agentIds }),
    onSuccess: (_data, { prId }) => {
      qc.invalidateQueries({ queryKey: ["multi-agent", prId] });
      qc.invalidateQueries({ queryKey: ["pr-runs", prId] });
      qc.invalidateQueries({ queryKey: ["pr-active-runs", prId] });
    },
  });
}
