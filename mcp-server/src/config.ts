/**
 * Config — read env once at startup. All vars are optional; sane local defaults
 * point at the dev stack started by `./scripts/dev.sh` (server on :3001).
 */

export type Config = {
  /** Base URL of the running @devdigest/api instance. */
  apiUrl: string;
  /** Max time to poll a triggered review run before giving up (ms). */
  runTimeoutMs: number;
  /** Delay between successive run-status polls (ms). */
  pollIntervalMs: number;
  /** Per-HTTP-call timeout, via AbortController (ms). */
  httpTimeoutMs: number;
};

function readIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function loadConfig(): Config {
  return {
    apiUrl: process.env.DEVDIGEST_API_URL || "http://localhost:3001",
    runTimeoutMs: readIntEnv("DEVDIGEST_RUN_TIMEOUT_MS", 480_000),
    pollIntervalMs: readIntEnv("DEVDIGEST_POLL_INTERVAL_MS", 2_000),
    httpTimeoutMs: readIntEnv("DEVDIGEST_HTTP_TIMEOUT_MS", 30_000),
  };
}
