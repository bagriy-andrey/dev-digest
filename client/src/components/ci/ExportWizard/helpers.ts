/* ExportWizard/helpers.ts — pure functions: repo validation, workflow-file
   detection, edit merging, and client-side zip building (AC-33). No React,
   no network — `filesToZip` works from an already-fetched `CiFile[]`. */
import JSZip from "jszip";
import type { CiFile, CiInstallation } from "@/lib/types";
import { WIZARD_STEP_KEYS } from "./constants";

/** "owner/name" — same shape the server's `parseRepoRef` (D9) accepts. */
const REPO_RE = /^[\w.-]+\/[\w.-]+$/;

export function isValidRepo(repo: string): boolean {
  return REPO_RE.test(repo.trim());
}

export function isWorkflowFile(path: string): boolean {
  return path.startsWith(".github/workflows/") && path.endsWith(".yml");
}

/** Clamp a step index into wizard bounds — guards Back/Continue from ever
 *  landing outside the 4 defined steps. */
export function stepIndex(current: number, delta: number): number {
  const max = WIZARD_STEP_KEYS.length - 1;
  return Math.min(max, Math.max(0, current + delta));
}

/** Apply the wizard's in-memory `edits` map over the generated `CiFile[]`
 *  for display/zip purposes — client-side only mirror of the server's
 *  `applyFileOverrides` (D3), scoped to editable files. */
export function mergeEdits(files: CiFile[], edits: Record<string, string>): CiFile[] {
  return files.map((f) =>
    f.editable && Object.prototype.hasOwnProperty.call(edits, f.path)
      ? { ...f, contents: edits[f.path] ?? f.contents }
      : f,
  );
}

/** The subset of `edits` that actually corresponds to a generated, editable
 *  file — the shape `useExportCi()`'s `input.files` override array wants. */
export function editsToOverrideFiles(files: CiFile[], edits: Record<string, string>): CiFile[] {
  const editablePaths = new Set(files.filter((f) => f.editable).map((f) => f.path));
  return Object.entries(edits)
    .filter(([path]) => editablePaths.has(path))
    .map(([path, contents]) => ({ path, contents, editable: true }));
}

/** AC-26a — a different agent already installed in the typed repo. Re-running
 *  the wizard for the SAME agent must never trigger this (a normal update). */
export function findConflictingInstallation(
  installations: (CiInstallation & { agent_name?: string | null })[] | undefined,
  repo: string,
  agentId: string,
): (CiInstallation & { agent_name?: string | null }) | null {
  const trimmed = repo.trim();
  if (!trimmed || !installations) return null;
  return installations.find((i) => i.repo === trimmed && i.agent_id !== agentId) ?? null;
}

/** AC-33 — builds a zip entirely client-side from the already-fetched files
 *  (including the non-editable runner bundle); no server endpoint involved. */
export async function filesToZip(files: CiFile[]): Promise<Blob> {
  const zip = new JSZip();
  for (const f of files) zip.file(f.path, f.contents);
  return zip.generateAsync({ type: "blob" });
}
