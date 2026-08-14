import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isConfigChange, type ConfigChangePatch } from '../src/modules/agents/helpers.js';
import type { AgentRow } from '../src/modules/agents/repository.js';

/**
 * Hermetic table-driven tests for `isConfigChange`'s skills-aware clause
 * (SPEC-03 step 5 / AC-32). Locks in the regression guard BEFORE relying on
 * the `.it.test.ts` integration coverage: every existing caller that never
 * passes `skillIds` must see byte-identical behaviour to before this fix.
 */

const BASE: Pick<
  AgentRow,
  'name' | 'description' | 'provider' | 'model' | 'systemPrompt' | 'strategy' | 'ciFailOn' | 'repoIntel'
> = {
  name: 'Agent',
  description: 'desc',
  provider: 'openai',
  model: 'gpt-4o-mini',
  systemPrompt: 'Review the diff.',
  strategy: 'single_pass',
  ciFailOn: 'critical',
  repoIntel: false,
};

describe('isConfigChange — skills clause', () => {
  it('a column change is still detected when existing.skillIds happens to be present but patch.skillIds is absent (regression guard: unrelated presence of existing.skillIds never masks other clauses)', () => {
    const patch: ConfigChangePatch = { model: 'gpt-4o' };
    expect(isConfigChange({ ...BASE, skillIds: ['a', 'b'] }, patch)).toBe(true);
  });

  it('returns false when patch.skillIds is absent and nothing else changed', () => {
    const patch: ConfigChangePatch = {};
    expect(isConfigChange({ ...BASE, skillIds: ['a', 'b'] }, patch)).toBe(false);
  });

  it('returns false when existing.skillIds is absent, regardless of patch.skillIds', () => {
    const patch: ConfigChangePatch = { skillIds: ['x', 'y'] };
    expect(isConfigChange({ ...BASE }, patch)).toBe(false);
  });

  it('returns false when BOTH patch.skillIds and existing.skillIds are absent (today\'s exact behaviour, preserved)', () => {
    const patch: ConfigChangePatch = {};
    expect(isConfigChange({ ...BASE }, patch)).toBe(false);
  });

  it('returns true for a reordered skill list (order matters)', () => {
    const patch: ConfigChangePatch = { skillIds: ['b', 'a'] };
    expect(isConfigChange({ ...BASE, skillIds: ['a', 'b'] }, patch)).toBe(true);
  });

  it('returns true when the skill set differs (added/removed)', () => {
    const patch: ConfigChangePatch = { skillIds: ['a', 'b', 'c'] };
    expect(isConfigChange({ ...BASE, skillIds: ['a', 'b'] }, patch)).toBe(true);
  });

  it('returns false for an identical skill list (same order, same ids)', () => {
    const patch: ConfigChangePatch = { skillIds: ['a', 'b'] };
    expect(isConfigChange({ ...BASE, skillIds: ['a', 'b'] }, patch)).toBe(false);
  });

  it('returns false for two identical empty skill lists', () => {
    const patch: ConfigChangePatch = { skillIds: [] };
    expect(isConfigChange({ ...BASE, skillIds: [] }, patch)).toBe(false);
  });

  it('a skills-only diff does not mask other clauses: an unrelated column change is still independently detected', () => {
    const patch: ConfigChangePatch = { skillIds: ['a', 'b'], systemPrompt: 'Different prompt.' };
    expect(isConfigChange({ ...BASE, skillIds: ['a', 'b'] }, patch)).toBe(true);
  });
});

/**
 * Source-read assertion (no live 429 is observable under NODE_ENV=test — the
 * rate-limit plugin itself is disabled there, see `server/insights.md`):
 * confirm `POST /agents/:id/promote-version` declares a per-route rate limit
 * by reading the route registration block itself. Placed in this hermetic
 * file (not the `.it.test.ts`) so it actually executes without Docker.
 */
describe('POST /agents/:id/promote-version — rate limit declaration', () => {
  it('declares config.rateLimit on the route registration', () => {
    const routesPath = fileURLToPath(new URL('../src/modules/agents/routes.ts', import.meta.url));
    const source = readFileSync(routesPath, 'utf8');
    const idx = source.indexOf("app.post(\n    '/agents/:id/promote-version'");
    expect(idx).toBeGreaterThan(-1);
    const block = source.slice(idx, idx + 400);
    expect(block).toContain('rateLimit');
  });
});
