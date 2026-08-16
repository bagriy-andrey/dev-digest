import { readFileSync } from 'node:fs';
import { ConfigError } from '../../platform/errors.js';

/**
 * The module's one filesystem read: the ncc-bundled `agent-runner/dist/index.js`
 * that gets embedded verbatim as `.devdigest/runner/index.js` (AC-5/AC-28).
 *
 * Deliberately a plain exported function (not a class/service) taking its
 * config as an injectable parameter, so hermetic tests can pass a stub
 * without touching the real filesystem or `AppConfig`.
 */
export interface RunnerBundleConfig {
  /** Absolute path to the built `agent-runner/dist/index.js` (`AppConfig.runnerBundlePath`). */
  runnerBundlePath: string;
}

export function readRunnerBundle(config: RunnerBundleConfig): string {
  try {
    return readFileSync(config.runnerBundlePath, 'utf8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      throw new ConfigError(
        `Runner bundle not found at ${config.runnerBundlePath}. Build it first: ` +
          `cd agent-runner && pnpm install && pnpm build`,
        { path: config.runnerBundlePath },
      );
    }
    throw err;
  }
}
