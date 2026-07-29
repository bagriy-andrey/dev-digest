import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { AgentsRepository } from '../src/modules/agents/repository.js';
import { AgentsService } from '../src/modules/agents/service.js';
import type { Container } from '../src/platform/container.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[agents-promote] Docker not available — skipping integration tests.');
}

/**
 * Promote vN (SPEC-03 step 5 / AC-30, AC-31, AC-32). Exercises `promoteVersion`
 * directly against a real Postgres instance — same layering `agents-versions.it.test.ts`
 * uses (repository + service, no HTTP layer needed for these assertions).
 */
d('AgentsService.promoteVersion', () => {
  let pg: PgFixture;
  let repo: AgentsRepository;
  let service: AgentsService;
  let workspaceId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    repo = new AgentsRepository(pg.handle.db);
    service = new AgentsService({ db: pg.handle.db } as unknown as Container);
    const [ws] = await pg.handle.db
      .select({ id: t.workspaces.id })
      .from(t.workspaces)
      .where(eq(t.workspaces.name, 'default'));
    workspaceId = ws!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  it('promotes an older version: live config equals the promoted snapshot AND a new snapshot is recorded whose config equals it (AC-30)', async () => {
    const agent = await repo.insert({
      workspaceId,
      name: 'Promote Target',
      provider: 'openai',
      model: 'gpt-4o-mini',
      systemPrompt: 'v1 prompt',
    });
    // v1 already exists (from insert). Bump to v7 via 6 sequential system_prompt edits.
    for (let i = 2; i <= 7; i++) {
      await repo.update(workspaceId, agent.id, { systemPrompt: `v${i} prompt` });
    }
    const before = await repo.getById(workspaceId, agent.id);
    expect(before!.version).toBe(7);

    const v6 = await repo.getVersion(agent.id, 6);
    expect(v6!.configJson).toMatchObject({ system_prompt: 'v6 prompt' });

    const promoted = await service.promoteVersion(workspaceId, agent.id, 6);
    expect(promoted).toBeDefined();
    expect(promoted!.system_prompt).toBe('v6 prompt');
    expect(promoted!.version).toBe(8);

    const v8 = await repo.getVersion(agent.id, 8);
    expect(v8).toBeDefined();
    expect(v8!.configJson).toMatchObject({ system_prompt: 'v6 prompt' });
    // The new snapshot's config equals v6's config (modulo the version number itself,
    // which the snapshot's config_json never stores).
    expect(v8!.configJson).toEqual(v6!.configJson);
  });

  it('promoting the currently-live version is a no-op: version unchanged, no new agent_versions row (AC-31)', async () => {
    const agent = await repo.insert({
      workspaceId,
      name: 'Promote Noop',
      provider: 'openai',
      model: 'gpt-4o-mini',
      systemPrompt: 'only prompt',
    });
    expect((await repo.getById(workspaceId, agent.id))!.version).toBe(1);

    const before = await repo.listVersions(agent.id);
    expect(before).toHaveLength(1);

    const promoted = await service.promoteVersion(workspaceId, agent.id, 1);
    expect(promoted).toBeDefined();
    expect(promoted!.version).toBe(1);

    const after = await repo.listVersions(agent.id);
    expect(after).toHaveLength(1);
  });

  it('promoting a version that differs from live ONLY in linked skills still bumps + snapshots the restored skill set (AC-32)', async () => {
    const [skillA] = await pg.handle.db
      .insert(t.skills)
      .values({
        workspaceId,
        name: 'Skill A',
        description: 'a',
        type: 'custom',
        source: 'manual',
        body: 'Body A',
      })
      .returning();
    const [skillB] = await pg.handle.db
      .insert(t.skills)
      .values({
        workspaceId,
        name: 'Skill B',
        description: 'b',
        type: 'custom',
        source: 'manual',
        body: 'Body B',
      })
      .returning();

    const agent = await repo.insert({
      workspaceId,
      name: 'Promote Skills Only',
      provider: 'openai',
      model: 'gpt-4o-mini',
      systemPrompt: 'stable prompt',
    });
    expect((await repo.getById(workspaceId, agent.id))!.version).toBe(1);

    // v2: link both skills, ordered [A, B].
    await repo.update(workspaceId, agent.id, { skillIds: [skillA!.id, skillB!.id] });
    expect((await repo.getById(workspaceId, agent.id))!.version).toBe(2);
    const v2 = await repo.getVersion(agent.id, 2);
    expect(v2!.configJson).toMatchObject({ skills: [skillA!.id, skillB!.id] });

    // v3: unlink skill B, leaving only skill A. Nothing else about the config changes.
    await repo.update(workspaceId, agent.id, { skillIds: [skillA!.id] });
    const live = await repo.getById(workspaceId, agent.id);
    expect(live!.version).toBe(3);
    expect(await repo.skillIdsForAgent(agent.id)).toEqual([skillA!.id]);

    // Promote v2 (both skills) while live is v3 (skill A only) — config differs
    // ONLY in the linked skill set. Must still bump + snapshot the restored set.
    const promoted = await service.promoteVersion(workspaceId, agent.id, 2);
    expect(promoted).toBeDefined();
    expect(promoted!.version).toBe(4);

    const v4 = await repo.getVersion(agent.id, 4);
    expect(v4).toBeDefined();
    expect(v4!.configJson).toMatchObject({ skills: [skillA!.id, skillB!.id] });
    expect(await repo.skillIdsForAgent(agent.id)).toEqual([skillA!.id, skillB!.id]);
  });

  it('404s (via undefined) for an unknown agent or an unknown version', async () => {
    const agent = await repo.insert({
      workspaceId,
      name: 'Promote 404s',
      provider: 'openai',
      model: 'gpt-4o-mini',
      systemPrompt: 'x',
    });
    const ghost = '00000000-0000-0000-0000-000000000000';
    expect(await service.promoteVersion(workspaceId, ghost, 1)).toBeUndefined();
    expect(await service.promoteVersion(workspaceId, agent.id, 99)).toBeUndefined();
  });
});
