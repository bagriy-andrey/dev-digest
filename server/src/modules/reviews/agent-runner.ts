import type { Container } from '../../platform/container.js';
import type { Provider, RunEventKind, UnifiedDiff } from '@devdigest/shared';
import { reviewPullRequest, type ReviewOutcome } from '@devdigest/reviewer-core';
import type { AgentRow } from '../../db/rows.js';
import { REVIEW_STRATEGY } from './constants.js';

/**
 * Shared, behaviour-preserving extraction of the "run one agent's review"
 * logic out of `ReviewRunExecutor.runOneAgent` (PR-shaped I/O + persistence
 * stay in the caller; see `run-executor.ts`). Reused by the (future)
 * pre-push `review-diff` endpoint so both callers run the SAME agent logic
 * instead of duplicating it.
 *
 * STOPS before persistence: this module never inserts a review/finding row,
 * completes an agent_run, saves a trace, or touches the runBus — it only
 * resolves the LLM, builds the enrichment context, and calls the pure
 * `reviewPullRequest` engine.
 */

/** The tiny logging surface this runner needs. `RunLogger` already satisfies it structurally. */
export interface AgentRunLog {
  info(msg: string): void;
  step<T>(label: string, fn: () => T | Promise<T>, opts?: { kind?: string }): Promise<T>;
}

const NOOP_LOG: AgentRunLog = {
  info() {},
  async step(_label, fn) {
    return fn();
  },
};

export interface RunAgentReviewOpts {
  repoId: string;
  diff: UnifiedDiff;
  agent: AgentRow;
  /** Task framing line, e.g. "Review pull request #482 …" or a working-tree substitute. */
  taskPrefix: string;
  sessionId: string;
  /** PR-shaped, optional: PR author's description/body. Untrusted. */
  prDescription?: string;
  /** PR-shaped, optional: stored PR intent/scope (classifier output). */
  intent?: { summary: string; inScope: string[]; outOfScope: string[] };
  onEvent?: (e: { kind: RunEventKind; msg: string; data?: unknown }) => void;
  checkCancelled?: () => void;
  log?: AgentRunLog;
}

/**
 * Resolve the agent's LLM provider, build the repo-intel enrichment context
 * (callers digest / repo map / rank note — gated on `agent.repoIntel`),
 * load enabled linked skills, and run the pure review engine. Lifted
 * verbatim from `runOneAgent`'s middle section — same logic, same field
 * names, same conditional-spread patterns for optional `reviewPullRequest`
 * fields.
 */
export async function runAgentReview(container: Container, opts: RunAgentReviewOpts): Promise<ReviewOutcome> {
  const log = opts.log ?? NOOP_LOG;
  const { agent, diff, repoId } = opts;

  // Resolve the agent's LLM provider. (container.llm throws if the provider
  // key is missing — the caller is responsible for catching/persisting.)
  const llm = await log.step(
    `Resolving ${agent.provider} provider`,
    () => container.llm(agent.provider as Provider),
    { kind: 'tool' },
  );

  // Per-agent repo-intel toggle (Agent editor). When an agent opts out we
  // skip all enrichment entirely so its prompt is identical to the
  // repo-intel-off baseline — independent of the global REPO_INTEL_ENABLED
  // flag, which still gates the facade internally.
  const repoIntelOn = agent.repoIntel !== false;
  if (!repoIntelOn) log.info('Repo intel disabled for this agent — skipping context enrichment');

  // T1.3 — callers-in-prompt. Best-effort: when repo-intel is off the facade
  // returns []; we omit the section and behavior is identical to the
  // pre-T1.3 prompt (acceptance #10).
  const callersDigest = repoIntelOn ? await buildCallersDigest(container, repoId, diff, log) : undefined;

  // T3 — repo skeleton + "changed files are top-5%" framing. Both best-
  // effort: when repo-intel is off / unindexed the facade degrades and the
  // prompt is identical to the pre-T3 shape.
  const repoMap = repoIntelOn ? await buildRepoMapDigest(container, repoId, log) : undefined;
  const rankNote = repoIntelOn ? await buildRankNote(container, repoId, diff, log) : '';

  const task = opts.taskPrefix + rankNote;

  // Load enabled linked skills for this agent (both per-link AND global flag must be on).
  const linkedSkills = await container.agentsRepo.linkedSkills(agent.id);
  const enabledSkillBodies = linkedSkills
    .filter((l) => l.enabled && l.skill.enabled)
    .map((l) => l.skill.body);
  log.info(`Skills: ${enabledSkillBodies.length} of ${linkedSkills.length} linked skill(s) active`);

  // ---- Engine: assemble → single-pass → grounding -----------------------
  // The pure review pipeline lives in @devdigest/reviewer-core (shared with
  // the CI runner). This module owns only I/O: repo-intel context resolution
  // above; the caller owns persistence + observability.
  return reviewPullRequest({
    systemPrompt: agent.systemPrompt,
    model: agent.model,
    diff,
    llm,
    // Per-agent review strategy (configured in the Agent editor); falls back
    // to the studio default. single-pass = whole diff in one call.
    strategy: agent.strategy ?? REVIEW_STRATEGY,
    // Enabled linked skills → injected as "## Skills / rules" block.
    ...(enabledSkillBodies.length > 0 ? { skills: enabledSkillBodies } : {}),
    // T1.3 — pass the callers digest only when we built one. assemblePrompt
    // omits the section when this is empty/undefined.
    ...(callersDigest ? { callers: callersDigest } : {}),
    // T3 — repo skeleton, same omit-when-empty contract.
    ...(repoMap ? { repoMap } : {}),
    // PR author's description/body — untrusted; assemblePrompt wraps +
    // truncates it. Omitted when there is none (e.g. the working-tree caller).
    ...(opts.prDescription ? { prDescription: opts.prDescription } : {}),
    // Stored PR intent/scope (classifier output) — omitted when there is none
    // (e.g. the working-tree caller).
    ...(opts.intent ? { intent: opts.intent } : {}),
    task,
    sessionId: opts.sessionId,
    ...(opts.onEvent ? { onEvent: opts.onEvent } : {}),
    ...(opts.checkCancelled ? { checkCancelled: opts.checkCancelled } : {}),
  });
}

/**
 * Build a compact "Callers of changed symbols" digest for the prompt.
 *
 * Returns `undefined` when nothing should be added (flag off, no callers
 * found, or repo-intel errors) — `reviewPullRequest` omits the section in
 * that case (acceptance #10: flag off → identical prompt).
 *
 * Compact format: one bullet per caller, grouped by file. Trimmed (limit 10
 * rows per `getCallerSignatures` call) so the section stays under ~600
 * tokens even on heavy PRs.
 */
async function buildCallersDigest(
  container: Container,
  repoId: string,
  diff: UnifiedDiff,
  log: AgentRunLog,
): Promise<string | undefined> {
  const changedFiles = diff.files.map((f) => f.path);
  if (changedFiles.length === 0) return undefined;
  let rows;
  try {
    rows = await container.repoIntel.getCallerSignatures(repoId, changedFiles, 10);
  } catch (err) {
    // Never let an enrichment break the run — surface only as a Live Log info.
    log.info(`callers digest: repoIntel failed — ${(err as Error).message}`);
    return undefined;
  }
  if (rows.length === 0) return undefined;

  const byFile = new Map<string, string[]>();
  for (const r of rows) {
    const lines = byFile.get(r.file) ?? [];
    lines.push(`- \`${r.symbol}\` — ${r.signature}`);
    byFile.set(r.file, lines);
  }
  const out: string[] = [];
  for (const [file, lines] of byFile) {
    out.push(`### ${file}`);
    out.push(...lines);
  }
  log.info(`callers digest: ${rows.length} caller signature(s) attached`);
  return out.join('\n');
}

/**
 * T3 — fetch the cached repo skeleton for the prompt's `## Repo skeleton`
 * slot. Returns `undefined` when repo-intel is off / the repo isn't indexed
 * (the facade degrades), so the prompt stays identical to the pre-T3 shape.
 */
async function buildRepoMapDigest(
  container: Container,
  repoId: string,
  log: AgentRunLog,
): Promise<string | undefined> {
  try {
    const map = await container.repoIntel.getRepoMap(repoId);
    if (map.degraded || map.text.trim().length === 0) return undefined;
    log.info(`repo map: ${map.tokens} token(s) attached (cached=${map.cached})`);
    return map.text;
  } catch (err) {
    log.info(`repo map: repoIntel failed — ${(err as Error).message}`);
    return undefined;
  }
}

/**
 * T3 — a one-line "N of M changed files are in the top 5% most-depended-on"
 * note appended to the task framing, so the model prioritises hot core files.
 * Empty string when repo-intel is off / no changed file is hot.
 */
async function buildRankNote(
  container: Container,
  repoId: string,
  diff: UnifiedDiff,
  log: AgentRunLog,
): Promise<string> {
  const changedFiles = diff.files.map((f) => f.path);
  if (changedFiles.length === 0) return '';
  try {
    const ranks = await container.repoIntel.getFileRank(repoId, changedFiles);
    if (ranks.length === 0) return '';
    const hot = ranks.filter((r) => r.percentile >= 95);
    if (hot.length === 0) return '';
    log.info(`file rank: ${hot.length}/${changedFiles.length} changed file(s) in top 5%`);
    return `\n\n${hot.length} of ${changedFiles.length} changed file(s) are in the top 5% most-depended-on (high blast risk) — prioritise their correctness.`;
  } catch {
    return '';
  }
}
