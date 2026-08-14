/* hooks/evals.ts — React Query hooks for the Eval Pipeline (SPEC-03): eval
   case CRUD, single/batch/workspace run triggers (fire-and-forget, polled via
   `useEvalBatch`), dashboards, batch compare, and agent version listing/
   promotion. All requests go through `lib/api.ts` — never a bare `fetch`. */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type {
  AgentVersion,
  EvalBatchStart,
  EvalBatchStartAll,
  EvalBatchSummary,
  EvalCase,
  EvalCaseInput,
  EvalCompare,
  EvalDashboard,
  EvalRunRecord,
  EvalWorkspaceDashboard,
} from "../types";
// `Agent` isn't re-exported from `lib/types.ts` (only Eval*/AgentVersion were
// added there) — import it from the vendored shared path directly, mirroring
// `hooks/agents.ts`'s existing convention for this same type.
import type { Agent } from "@devdigest/shared";

/** `GET /eval-batches/:batchId` response — the batch summary plus its rows. */
export type EvalBatchDetail = EvalBatchSummary & { runs: EvalRunRecord[] };

// ---------------------------------------------------------------------------
// Eval cases
// ---------------------------------------------------------------------------

export function useEvalCases(agentId: string | null | undefined) {
  return useQuery({
    queryKey: ["eval-cases", agentId],
    queryFn: () => api.get<EvalCase[]>(`/agents/${agentId}/eval-cases`),
    enabled: !!agentId,
  });
}

export function useCreateEvalCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ agentId, input }: { agentId: string; input: EvalCaseInput }) =>
      api.post<EvalCase>(`/agents/${agentId}/eval-cases`, input),
    onSuccess: (_data, { agentId }) => {
      qc.invalidateQueries({ queryKey: ["eval-cases", agentId] });
    },
  });
}

export function useUpdateEvalCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      agentId,
      caseId,
      input,
    }: {
      agentId: string;
      caseId: string;
      input: EvalCaseInput;
    }) => api.put<EvalCase>(`/eval-cases/${caseId}`, input),
    onSuccess: (_data, { agentId }) => {
      qc.invalidateQueries({ queryKey: ["eval-cases", agentId] });
    },
  });
}

export function useDeleteEvalCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ caseId }: { agentId: string; caseId: string }) =>
      api.del<{ ok: boolean }>(`/eval-cases/${caseId}`),
    onSuccess: (_data, { agentId }) => {
      qc.invalidateQueries({ queryKey: ["eval-cases", agentId] });
    },
  });
}

export function useCreateEvalCaseFromFinding() {
  return useMutation({
    mutationFn: (findingId: string) => api.post<EvalCase>(`/findings/${findingId}/eval-case`),
  });
}

// ---------------------------------------------------------------------------
// Run triggers (fire-and-forget — invalidate dashboards + eval-runs so the
// UI's next poll/refetch picks up the in-flight batch; AC-12).
// ---------------------------------------------------------------------------

function invalidateAfterRun(qc: ReturnType<typeof useQueryClient>, agentId?: string) {
  qc.invalidateQueries({ queryKey: ["eval-dashboard"] });
  if (agentId) {
    qc.invalidateQueries({ queryKey: ["eval-dashboard", agentId] });
    qc.invalidateQueries({ queryKey: ["eval-runs", agentId] });
  }
}

export function useRunEvalCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ caseId }: { agentId: string; caseId: string }) =>
      api.post<EvalBatchStart>(`/eval-cases/${caseId}/run`),
    onSuccess: (_data, { agentId }) => invalidateAfterRun(qc, agentId),
  });
}

export function useRunAgentEvals() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (agentId: string) => api.post<EvalBatchStart>(`/agents/${agentId}/eval-runs`),
    onSuccess: (_data, agentId) => invalidateAfterRun(qc, agentId),
  });
}

export function useRunAllEvals() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<EvalBatchStartAll>("/eval-runs"),
    onSuccess: () => invalidateAfterRun(qc),
  });
}

// ---------------------------------------------------------------------------
// Runs / batches
// ---------------------------------------------------------------------------

export function useEvalRuns(agentId: string | null | undefined, batchId?: string | null) {
  return useQuery({
    queryKey: ["eval-runs", agentId, batchId ?? null],
    queryFn: () => {
      const qs = batchId ? `?batch_id=${encodeURIComponent(batchId)}` : "";
      return api.get<EvalRunRecord[]>(`/agents/${agentId}/eval-runs${qs}`);
    },
    enabled: !!agentId,
  });
}

/** Polls while the batch is still running (AC-12); stops once `status` flips
 *  to `"complete"`. */
export function useEvalBatch(batchId: string | null | undefined) {
  return useQuery({
    queryKey: ["eval-batch", batchId],
    queryFn: () => api.get<EvalBatchDetail>(`/eval-batches/${batchId}`),
    enabled: !!batchId,
    refetchInterval: (query) => (query.state.data?.status === "running" ? 2000 : false),
  });
}

export function useEvalCompare(a: string | null | undefined, b: string | null | undefined) {
  return useQuery({
    queryKey: ["eval-compare", a, b],
    queryFn: () =>
      api.get<EvalCompare>(
        `/eval-batches/compare?a=${encodeURIComponent(a as string)}&b=${encodeURIComponent(b as string)}`,
      ),
    enabled: !!a && !!b,
  });
}

// ---------------------------------------------------------------------------
// Dashboards
// ---------------------------------------------------------------------------

/** Polls while the agent's most recent batch is still running (mirrors
 *  `useEvalBatch`'s AC-12 pattern) — otherwise a batch that finishes after
 *  the initial fetch would show "Running…" forever until a manual reload. */
export function useAgentEvalDashboard(agentId: string | null | undefined) {
  return useQuery({
    queryKey: ["eval-dashboard", agentId],
    queryFn: () => api.get<EvalDashboard>(`/agents/${agentId}/eval-dashboard`),
    enabled: !!agentId,
    refetchInterval: (query) =>
      query.state.data?.recent_batches?.[0]?.status === "running" ? 2000 : false,
  });
}

export function useWorkspaceEvalDashboard() {
  return useQuery({
    queryKey: ["eval-dashboard"],
    queryFn: () => api.get<EvalWorkspaceDashboard>("/eval-dashboard"),
  });
}

// ---------------------------------------------------------------------------
// Agent versions (read + Promote)
// ---------------------------------------------------------------------------

export function useAgentVersions(agentId: string | null | undefined) {
  return useQuery({
    queryKey: ["agent-versions", agentId],
    queryFn: () => api.get<AgentVersion[]>(`/agents/${agentId}/versions`),
    enabled: !!agentId,
  });
}

export function usePromoteAgentVersion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ agentId, version }: { agentId: string; version: number }) =>
      api.post<Agent>(`/agents/${agentId}/promote-version`, { version }),
    onSuccess: (_data, { agentId }) => {
      qc.invalidateQueries({ queryKey: ["agent", agentId] });
      qc.invalidateQueries({ queryKey: ["agents"] });
      qc.invalidateQueries({ queryKey: ["agent-versions", agentId] });
    },
  });
}
