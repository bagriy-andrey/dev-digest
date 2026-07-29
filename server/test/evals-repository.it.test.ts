import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { EvalsRepository } from '../src/modules/evals/repository.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[evals-repository] Docker not available — skipping integration tests.');
}

/**
 * EvalsRepository (SPEC-03 step 3). Real Postgres via testcontainers — see
 * `server/insights.md` if this suite can't start a container in your sandbox
 * (it is a documented environment limitation, not a code regression).
 */
d('EvalsRepository', () => {
  let pg: PgFixture;
  let repo: EvalsRepository;
  let workspaceId: string;
  let otherWorkspaceId: string;

  beforeAll(async () => {
    pg = await startPg();
    const { workspaceId: ws } = await seed(pg.handle.db);
    workspaceId = ws;
    repo = new EvalsRepository(pg.handle.db);

    const [other] = await pg.handle.db
      .insert(t.workspaces)
      .values({ name: 'evals-repo-other-workspace' })
      .returning();
    otherWorkspaceId = other!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  describe('cases', () => {
    it('insert/get/update/delete round-trip, workspace-scoped', async () => {
      const ownerId = randomUUID();

      const inserted = await repo.insertCase({
        workspaceId,
        ownerKind: 'agent',
        ownerId,
        name: 'Round trip case',
        inputDiff: 'diff --git a/x b/x',
        inputFiles: [{ path: 'x', additions: 1, deletions: 0 }],
        inputMeta: { pr_id: 'pr-1' },
        expectedOutput: [{ kind: 'must_find', file: 'x', start_line: 1, end_line: 1 }],
        notes: 'a note',
      });
      expect(inserted.name).toBe('Round trip case');
      expect(inserted.input_diff).toBe('diff --git a/x b/x');

      const got = await repo.getCase(workspaceId, inserted.id);
      expect(got).toEqual(inserted);

      // A case belonging to a DIFFERENT workspace is invisible via getCase.
      const otherWsCase = await repo.insertCase({
        workspaceId: otherWorkspaceId,
        ownerKind: 'agent',
        ownerId,
        name: 'Other workspace case',
      });
      expect(await repo.getCase(workspaceId, otherWsCase.id)).toBeUndefined();
      expect(await repo.getCase(otherWorkspaceId, otherWsCase.id)).toBeDefined();

      const updated = await repo.updateCase(workspaceId, inserted.id, {
        name: 'Renamed',
        notes: 'updated note',
      });
      expect(updated?.name).toBe('Renamed');
      expect(updated?.notes).toBe('updated note');
      // Unspecified fields are left alone.
      expect(updated?.input_diff).toBe('diff --git a/x b/x');

      // Update scoped to the wrong workspace is a no-op (returns undefined).
      expect(
        await repo.updateCase(otherWorkspaceId, inserted.id, { name: 'Hijacked' }),
      ).toBeUndefined();

      const deleted = await repo.deleteCase(workspaceId, inserted.id);
      expect(deleted).toBe(true);
      expect(await repo.getCase(workspaceId, inserted.id)).toBeUndefined();

      // Deleting again is a no-op.
      expect(await repo.deleteCase(workspaceId, inserted.id)).toBe(false);
    });

    it('listByOwner returns 8+ cases for one agent with no pagination/truncation (AC-10)', async () => {
      const ownerId = randomUUID();
      const names = Array.from({ length: 9 }, (_, i) => `Case ${i}`);
      for (const name of names) {
        await repo.insertCase({ workspaceId, ownerKind: 'agent', ownerId, name });
      }

      const list = await repo.listByOwner(workspaceId, 'agent', ownerId);
      expect(list.length).toBe(9);
      expect(new Set(list.map((c) => c.name))).toEqual(new Set(names));

      // A different owner's cases (or a different workspace's) never leak in.
      const otherOwnerId = randomUUID();
      await repo.insertCase({ workspaceId, ownerKind: 'agent', ownerId: otherOwnerId, name: 'Unrelated' });
      expect(await repo.listByOwner(workspaceId, 'agent', ownerId)).toHaveLength(9);

      await repo.insertCase({ workspaceId: otherWorkspaceId, ownerKind: 'agent', ownerId, name: 'Wrong workspace' });
      expect(await repo.listByOwner(workspaceId, 'agent', ownerId)).toHaveLength(9);
    });

    it('countByOwner matches listByOwner', async () => {
      const ownerId = randomUUID();
      for (let i = 0; i < 3; i++) {
        await repo.insertCase({ workspaceId, ownerKind: 'skill', ownerId, name: `Skill case ${i}` });
      }
      expect(await repo.countByOwner(workspaceId, 'skill', ownerId)).toBe(3);
    });

    it('findByFindingId matches on input_meta->>finding_id', async () => {
      const ownerId = randomUUID();
      const findingId = randomUUID();
      const created = await repo.insertCase({
        workspaceId,
        ownerKind: 'agent',
        ownerId,
        name: 'From finding',
        inputMeta: { finding_id: findingId, pr_id: 'pr-9' },
      });

      const found = await repo.findByFindingId(workspaceId, ownerId, findingId);
      expect(found?.id).toBe(created.id);

      // A different finding id (or a different owner) must not match.
      expect(await repo.findByFindingId(workspaceId, ownerId, randomUUID())).toBeUndefined();
      expect(await repo.findByFindingId(workspaceId, randomUUID(), findingId)).toBeUndefined();
    });

    it('a null input_diff column maps to "" in the returned DTO, never null (edge case 15)', async () => {
      const ownerId = randomUUID();
      // Bypass insertCase's own `?? null` default and confirm the DB's actual
      // NULL round-trips through toEvalCase as an empty string, never `null`.
      const [row] = await pg.handle.db
        .insert(t.evalCases)
        .values({ workspaceId, ownerKind: 'agent', ownerId, name: 'Null diff case', inputDiff: null })
        .returning();
      expect(row!.inputDiff).toBeNull();

      const got = await repo.getCase(workspaceId, row!.id);
      expect(got?.input_diff).toBe('');
      expect(got?.input_diff).not.toBeNull();

      const [listed] = await repo.listByOwner(workspaceId, 'agent', ownerId);
      expect(listed?.input_diff).toBe('');
    });
  });

  describe('runs', () => {
    it('deleting a case cascades to its eval_runs rows (AC-9)', async () => {
      const ownerId = randomUUID();
      const evalCase = await repo.insertCase({ workspaceId, ownerKind: 'agent', ownerId, name: 'Cascade case' });
      const run1 = await repo.insertRun({ caseId: evalCase.id, pass: true });
      const run2 = await repo.insertRun({ caseId: evalCase.id, pass: false });

      const before = await pg.handle.db.select().from(t.evalRuns).where(eq(t.evalRuns.caseId, evalCase.id));
      expect(before).toHaveLength(2);

      await repo.deleteCase(workspaceId, evalCase.id);

      const after = await pg.handle.db.select().from(t.evalRuns).where(eq(t.evalRuns.caseId, evalCase.id));
      expect(after).toHaveLength(0);
      expect(
        (await pg.handle.db.select().from(t.evalRuns).where(eq(t.evalRuns.id, run1.id))).length,
      ).toBe(0);
      expect(
        (await pg.handle.db.select().from(t.evalRuns).where(eq(t.evalRuns.id, run2.id))).length,
      ).toBe(0);
    });

    it('runsForBatch / runsForOwner / recentRunsForWorkspace / caseIdsInBatch', async () => {
      const ownerId = randomUUID();
      const caseA = await repo.insertCase({ workspaceId, ownerKind: 'agent', ownerId, name: 'Batch case A' });
      const caseB = await repo.insertCase({ workspaceId, ownerKind: 'agent', ownerId, name: 'Batch case B' });
      const batchId = randomUUID();

      const runA = await repo.insertRun({ caseId: caseA.id, batchId, agentVersion: 3, pass: true });
      const runB = await repo.insertRun({ caseId: caseB.id, batchId, agentVersion: 3, pass: false });

      const forBatch = await repo.runsForBatch(batchId);
      expect(forBatch.map((r) => r.id).sort()).toEqual([runA.id, runB.id].sort());
      expect(forBatch.every((r) => r.batch_id === batchId)).toBe(true);
      expect(forBatch.every((r) => r.agent_version === 3)).toBe(true);
      expect(forBatch.find((r) => r.id === runA.id)?.case_name).toBe('Batch case A');

      const forOwner = await repo.runsForOwner(workspaceId, ownerId, { batchId });
      expect(forOwner).toHaveLength(2);

      const limited = await repo.runsForOwner(workspaceId, ownerId, { limit: 1 });
      expect(limited).toHaveLength(1);

      // Another workspace's owner must never see these runs.
      expect(await repo.runsForOwner(otherWorkspaceId, ownerId, {})).toHaveLength(0);

      const workspaceRecent = await repo.recentRunsForWorkspace(workspaceId, 50);
      expect(workspaceRecent.some((r) => r.id === runA.id)).toBe(true);
      expect(workspaceRecent.some((r) => r.id === runB.id)).toBe(true);

      const caseIds = await repo.caseIdsInBatch(batchId);
      expect(caseIds).toEqual(new Set([caseA.id, caseB.id]));
    });

    it('batchesForOwner respects its limit and orders by most-recent batch first', async () => {
      const ownerId = randomUUID();
      const evalCase = await repo.insertCase({ workspaceId, ownerKind: 'agent', ownerId, name: 'Multi-batch case' });

      const batchIds = [randomUUID(), randomUUID(), randomUUID()];
      // Insert sequentially so ran_at (defaultNow()) orders them distinctly.
      for (const batchId of batchIds) {
        await repo.insertRun({ caseId: evalCase.id, batchId, pass: true });
        await new Promise((r) => setTimeout(r, 5));
      }

      const all = await repo.batchesForOwner(workspaceId, ownerId, 20);
      expect(all).toEqual([batchIds[2], batchIds[1], batchIds[0]]);

      const limited = await repo.batchesForOwner(workspaceId, ownerId, 2);
      expect(limited).toEqual([batchIds[2], batchIds[1]]);
    });

    it('caseCountsByOwner groups cases per owner within the workspace', async () => {
      const ownerId = randomUUID();
      await repo.insertCase({ workspaceId, ownerKind: 'agent', ownerId, name: 'Count case 1' });
      await repo.insertCase({ workspaceId, ownerKind: 'agent', ownerId, name: 'Count case 2' });

      const counts = await repo.caseCountsByOwner(workspaceId);
      const mine = counts.find((c) => c.ownerKind === 'agent' && c.ownerId === ownerId);
      expect(mine?.count).toBe(2);
    });
  });
});
