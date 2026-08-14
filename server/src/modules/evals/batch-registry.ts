/**
 * D7 — in-process module-scope singleton guarding "one eval batch in flight
 * per agent at a time" (AC-23). Consistent with the repo's existing "ONE API
 * instance per DB" assumption (the orphan-run reaper relies on the same
 * thing — `server/AGENTS.md`). A DB-derived guard would have a race window
 * and couldn't distinguish "in flight" from "crashed mid-batch"; this
 * in-memory Map is simple and deterministically testable.
 *
 * Deliberately NOT a class — a bare module-scope `Map` so every importer
 * shares the exact same registry instance (no DI, no container entry).
 */

const running = new Map<string, string>(); // agentId -> batchId

/** Reserve the "running" slot for `agentId`. Returns false if already running. */
export function tryAcquire(agentId: string, batchId: string): boolean {
  if (running.has(agentId)) return false;
  running.set(agentId, batchId);
  return true;
}

/** Release the slot (call in a `finally`, regardless of success/failure). */
export function release(agentId: string): void {
  running.delete(agentId);
}

export function isRunning(agentId: string): boolean {
  return running.has(agentId);
}

export function runningBatchId(agentId: string): string | undefined {
  return running.get(agentId);
}

/** Test-only: clear all in-flight state between hermetic test cases. */
export function __resetForTests(): void {
  running.clear();
}
