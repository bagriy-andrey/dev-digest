/**
 * AC-53 — in-process module-scope singleton guarding "one ingest pass per
 * repo in flight at a time". Mirrors `modules/evals/batch-registry.ts`
 * exactly (see that file's own doc comment): consistent with the repo's
 * existing "ONE API instance per DB" assumption (`server/AGENTS.md`).
 *
 * Deliberately NOT a class — a bare module-scope `Set` so every importer
 * shares the exact same registry instance (no DI, no container entry).
 */

const running = new Set<string>(); // repo ("owner/name")

/** Reserve the "running" slot for `repo`. Returns false if already running. */
export function tryAcquire(repo: string): boolean {
  if (running.has(repo)) return false;
  running.add(repo);
  return true;
}

/** Release the slot (call in a `finally`, regardless of success/failure). */
export function release(repo: string): void {
  running.delete(repo);
}

export function isRunning(repo: string): boolean {
  return running.has(repo);
}

/** Test-only: clear all in-flight state between hermetic test cases. */
export function __resetForTests(): void {
  running.clear();
}
