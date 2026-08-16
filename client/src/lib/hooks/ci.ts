/* hooks/ci.ts — React Query hooks for Export-to-CI (SPEC-04): installations,
   ingested runs, refresh, and the export mutation the wizard's Preview/Install
   steps both drive. All requests go through `lib/api.ts` — never a bare
   `fetch`.

   Transport types (D5, PLAN-04 §1D): the server route extends the frozen
   vendored `CiRun`/`CiInstallation` contracts with a couple of display-only
   fields at the response boundary (join results, not persisted columns) —
   `CiRunRow`/`CiInstallationRow` mirror that extension client-side rather
   than widening the vendored contract itself. */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { CiExport, CiExportInput, CiInstallation, CiRun } from "../types";

export type CiRunRow = CiRun & { repo: string | null };
export type CiInstallationRow = CiInstallation & {
  agent_name: string | null;
  latest_run: CiRun | null;
};

/** `POST /ci-runs/refresh` response — a local (non-vendored) route schema. */
export interface CiRefreshSummary {
  installationsChecked: number;
  runsExamined: number;
  artifactsValid: number;
  artifactsInvalid: number;
  artifactsMissing: number;
  skipped: number;
  failures: { repo: string; reason: string }[];
}

export function useCiInstallations(agentId?: string) {
  return useQuery({
    queryKey: ["ci-installations", agentId ?? "all"],
    queryFn: () =>
      api.get<CiInstallationRow[]>(
        `/ci-installations${agentId ? `?agent_id=${encodeURIComponent(agentId)}` : ""}`,
      ),
  });
}

export function useCiRuns() {
  return useQuery({
    queryKey: ["ci-runs"],
    queryFn: () => api.get<CiRunRow[]>("/ci-runs"),
  });
}

export function useRefreshCiRuns() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<CiRefreshSummary>("/ci-runs/refresh"),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ci-runs"] });
      qc.invalidateQueries({ queryKey: ["ci-installations"] });
    },
  });
}

/** Serves both the wizard's Preview (`action: 'files'`) and Install
 *  (`action: 'open_pr'`) requests — one mutation, the `input.action` decides
 *  the server-side behaviour (D4). Only a successful `open_pr` upserts an
 *  installation row, so only that case invalidates `ci-installations`. */
export function useExportCi() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ agentId, input }: { agentId: string; input: CiExportInput }) =>
      api.post<CiExport>(`/agents/${agentId}/export-ci`, input),
    onSuccess: (_data, { input }) => {
      if (input.action === "open_pr") {
        qc.invalidateQueries({ queryKey: ["ci-installations"] });
      }
    },
  });
}
