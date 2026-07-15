/**
 * Project Context module (SPEC-01) — real-Postgres integration tests.
 *
 * NOTE (per `server/insights.md`'s Tool & Library Notes): `testcontainers`
 * cannot start a Postgres container in this sandbox (Rancher Desktop / k3s
 * daemon isn't a strategy testcontainers auto-detects) — this file is written
 * and typechecked, but `dockerAvailable()` gates every suite behind
 * `describe.skip` here, exactly like every other pre-existing `.it.test.ts`.
 * Don't debug a "0 tests ran" result for this file as a regression.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  GitClient,
  RepoRef,
  CloneOptions,
  UnifiedDiff,
  BlameLine,
  GitCommit,
} from '@devdigest/shared';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { ContextService } from '../src/modules/context/service.js';
import type { Container } from '../src/platform/container.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[context] Docker not available — skipping integration tests.');
}

/**
 * `GitClient` rooted at a real temp directory standing in for a repo clone —
 * `clonePathFor` ignores `repo` and always returns `cloneDir`, `readFile`
 * delegates to real `fs.readFile` (so it genuinely throws ENOENT for a
 * missing/deleted path, unlike `MockGitClient.readFile`, which returns `''`
 * for anything not in its `files` map — needed to exercise AC-19 for real).
 */
class TempCloneGitClient implements GitClient {
  constructor(private cloneDir: string) {}
  clonePathFor(): string {
    return this.cloneDir;
  }
  async clone(repo: RepoRef, _url: string, _opts?: CloneOptions): Promise<{ path: string }> {
    return { path: this.clonePathFor() };
  }
  async fetchPullHead(): Promise<void> {}
  async sync(): Promise<{ head: string }> {
    return { head: 'a1b2c3d4' };
  }
  async currentHead(): Promise<string> {
    return 'a1b2c3d4';
  }
  async diff(): Promise<UnifiedDiff> {
    return { raw: '', files: [] };
  }
  async diffNameOnly(): Promise<string[]> {
    return [];
  }
  async blame(): Promise<BlameLine[]> {
    return [];
  }
  async log(): Promise<GitCommit[]> {
    return [];
  }
  async readFile(_repo: RepoRef, relPath: string): Promise<string> {
    const fs = await import('node:fs/promises');
    return fs.readFile(join(this.cloneDir, relPath), 'utf8');
  }
}

async function writeFileAt(root: string, rel: string, contents: string): Promise<void> {
  const full = join(root, rel);
  const dir = full.slice(0, full.lastIndexOf('/'));
  if (dir && dir !== root) await mkdir(dir, { recursive: true });
  await writeFile(full, contents);
}

let repoSeq = 0;
async function makeRepo(db: PgFixture['handle']['db'], workspaceId: string) {
  const name = `context-${repoSeq++}`;
  const [repo] = await db
    .insert(t.repos)
    .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
    .returning();
  return repo!;
}

d('Project Context module (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let cloneDir: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  function appWith() {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    return buildApp({ config, db: pg.handle.db, overrides: { git: new TempCloneGitClient(cloneDir) } });
  }

  async function createAgent(app: Awaited<ReturnType<typeof appWith>>, name: string) {
    const res = await app.inject({
      method: 'POST',
      url: '/agents',
      payload: { name, provider: 'openai', model: 'gpt-4o-mini', system_prompt: 'Review the diff.' },
    });
    expect(res.statusCode).toBe(201);
    return res.json().id as string;
  }

  async function createSkill(app: Awaited<ReturnType<typeof appWith>>, name: string) {
    const res = await app.inject({
      method: 'POST',
      url: '/skills',
      payload: { name, type: 'convention', body: 'Some skill body.' },
    });
    expect(res.statusCode).toBe(201);
    return res.json().id as string;
  }

  describe('discovery + Project Context page (Screen 1)', () => {
    beforeAll(async () => {
      cloneDir = await mkdtemp(join(tmpdir(), 'context-it-'));
      await writeFileAt(cloneDir, 'specs/api.md', '# API rules\n## Details\nBody text.\n');
      await writeFileAt(cloneDir, 'docs/guide/setup.md', '# Setup\nBody text.\n');
      await writeFileAt(cloneDir, 'insights/notes.md', '# Notes\n');
    });
    afterAll(async () => {
      await rm(cloneDir, { recursive: true, force: true });
    });

    it('GET /repos/:id/context lists discovered docs with source_type/size/headings', async () => {
      const app = await appWith();
      const repo = await makeRepo(pg.handle.db, workspaceId);

      const res = await app.inject({ method: 'GET', url: `/repos/${repo.id}/context` });
      expect(res.statusCode).toBe(200);
      const docs = res.json() as { path: string; source_type: string; headings: number }[];
      const byPath = new Map(docs.map((doc) => [doc.path, doc]));

      expect(byPath.get('specs/api.md')?.source_type).toBe('specs');
      expect(byPath.get('specs/api.md')?.headings).toBe(2);
      expect(byPath.get('docs/guide/setup.md')?.source_type).toBe('docs');
      expect(byPath.get('insights/notes.md')?.source_type).toBe('insights');
      await app.close();
    });

    it('GET /repos/:id/context/file returns the exact raw content for a discovered path', async () => {
      const app = await appWith();
      const repo = await makeRepo(pg.handle.db, workspaceId);

      const res = await app.inject({
        method: 'GET',
        url: `/repos/${repo.id}/context/file?path=${encodeURIComponent('specs/api.md')}`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().content).toContain('# API rules');
      await app.close();
    });

    it('GET /repos/:id/context/file rejects a traversal path before any read (path-guard sink)', async () => {
      const app = await appWith();
      const repo = await makeRepo(pg.handle.db, workspaceId);

      const res = await app.inject({
        method: 'GET',
        url: `/repos/${repo.id}/context/file?path=${encodeURIComponent('../../etc/passwd')}`,
      });
      expect(res.statusCode).toBe(422);
      await app.close();
    });

    it('GET /repos/:id/context/file 404s for a path not in the current discovered set', async () => {
      const app = await appWith();
      const repo = await makeRepo(pg.handle.db, workspaceId);

      const res = await app.inject({
        method: 'GET',
        url: `/repos/${repo.id}/context/file?path=${encodeURIComponent('specs/does-not-exist.md')}`,
      });
      expect(res.statusCode).toBe(404);
      await app.close();
    });

    it('POST /repos/:id/context/reindex persists files/chunks/scanned_at (AC-4)', async () => {
      const app = await appWith();
      const repo = await makeRepo(pg.handle.db, workspaceId);

      const res = await app.inject({ method: 'POST', url: `/repos/${repo.id}/context/reindex` });
      expect(res.statusCode).toBe(200);
      const status = res.json();
      expect(status.files).toBe(3);
      expect(status.chunks).toBe(4); // 2 + 1 + 1 headings across the three fixture docs
      expect(typeof status.scanned_at).toBe('string');
      await app.close();
    });

    it('returns an empty list + a graceful footer when the clone directory is missing entirely', async () => {
      const app = await buildApp({
        config: loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv),
        db: pg.handle.db,
        overrides: { git: new TempCloneGitClient(join(cloneDir, 'does-not-exist')) },
      });
      const repo = await makeRepo(pg.handle.db, workspaceId);

      const res = await app.inject({ method: 'GET', url: `/repos/${repo.id}/context` });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([]);
      await app.close();
    });
  });

  describe('Agent/Skill Context tabs + "Used by N agents" / COVERAGE metrics (AC-7/AC-8)', () => {
    // Every test below uses its OWN doc path (never re-attaching a path another
    // test in this shared-workspace suite already used) so "used_by" assertions
    // stay exact regardless of test order / accumulated agents from earlier tests.
    beforeAll(async () => {
      cloneDir = await mkdtemp(join(tmpdir(), 'context-it-metrics-'));
      await writeFileAt(cloneDir, 'specs/order-test.md', '# Order test\n');
      await writeFileAt(cloneDir, 'specs/coverage-test.md', '# Coverage test\n');
      await writeFileAt(cloneDir, 'specs/enabled-skill-test.md', '# Enabled skill test\n');
      await writeFileAt(cloneDir, 'specs/disabled-skill-test.md', '# Disabled skill test\n');
    });
    afterAll(async () => {
      await rm(cloneDir, { recursive: true, force: true });
    });

    it('PUT /agents/:id/context persists attach order; GET reflects it', async () => {
      const app = await appWith();
      const agentId = await createAgent(app, 'Context Agent A');

      const put = await app.inject({
        method: 'PUT',
        url: `/agents/${agentId}/context`,
        payload: { paths: ['specs/order-test.md'] },
      });
      expect(put.statusCode).toBe(200);
      expect(put.json()).toEqual([{ path: 'specs/order-test.md', order: 0 }]);

      const get = await app.inject({ method: 'GET', url: `/agents/${agentId}/context` });
      expect(get.json()).toEqual([{ path: 'specs/order-test.md', order: 0 }]);
      await app.close();
    });

    it('a doc attached to N of the workspace\'s M agents reports used_by=N and coverage=round(N/M*100)', async () => {
      const app = await appWith();
      const repo = await makeRepo(pg.handle.db, workspaceId);

      const agentA = await createAgent(app, 'Metric Agent A');
      const agentB = await createAgent(app, 'Metric Agent B');

      await app.inject({
        method: 'PUT',
        url: `/agents/${agentA}/context`,
        payload: { paths: ['specs/coverage-test.md'] },
      });

      const totalAgents = (await app.container.agentsRepo.list(workspaceId)).length;

      const res = await app.inject({ method: 'GET', url: `/repos/${repo.id}/context` });
      const doc = (res.json() as { path: string; used_by: number; coverage: number }[]).find(
        (d) => d.path === 'specs/coverage-test.md',
      );

      expect(doc?.used_by).toBe(1);
      expect(doc?.coverage).toBe(Math.round((1 / totalAgents) * 100));

      // agentB never attached the doc directly and has no skills → doesn't count.
      void agentB;
      await app.close();
    });

    it('a doc reached only via an ENABLED linked skill counts toward "used by" (AC-14)', async () => {
      const app = await appWith();
      const repo = await makeRepo(pg.handle.db, workspaceId);
      const agentId = await createAgent(app, 'Skill-Inherit Agent');
      const skillId = await createSkill(app, 'Shared Skill');

      await app.inject({
        method: 'PUT',
        url: `/skills/${skillId}/context`,
        payload: { paths: ['specs/enabled-skill-test.md'] },
      });
      await app.container.agentsRepo.linkSkill(agentId, skillId, 0, true);

      const res = await app.inject({ method: 'GET', url: `/repos/${repo.id}/context` });
      const doc = (res.json() as { path: string; used_by: number }[]).find(
        (d) => d.path === 'specs/enabled-skill-test.md',
      );
      expect(doc?.used_by).toBe(1);
      await app.close();
    });

    it('a doc reached via a DISABLED linked skill does NOT count (per-link enabled gate)', async () => {
      const app = await appWith();
      const repo = await makeRepo(pg.handle.db, workspaceId);
      const agentId = await createAgent(app, 'Disabled-Link Agent');
      const skillId = await createSkill(app, 'Disabled Skill');

      await app.inject({
        method: 'PUT',
        url: `/skills/${skillId}/context`,
        payload: { paths: ['specs/disabled-skill-test.md'] },
      });
      await app.container.agentsRepo.linkSkill(agentId, skillId, 0, false); // link disabled

      const res = await app.inject({ method: 'GET', url: `/repos/${repo.id}/context` });
      const doc = (res.json() as { path: string; used_by: number }[]).find(
        (d) => d.path === 'specs/disabled-skill-test.md',
      );
      expect(doc?.used_by).toBe(0); // disabled link never contributes (AC-14)
      await app.close();
    });
  });

  describe('resolveEffectiveSpecs (run-time injection resolver, consumed by run-executor in step 5)', () => {
    beforeAll(async () => {
      cloneDir = await mkdtemp(join(tmpdir(), 'context-it-resolve-'));
      await writeFileAt(cloneDir, 'specs/a.md', 'Content A');
      await writeFileAt(cloneDir, 'specs/b.md', 'Content B');
      await writeFileAt(cloneDir, 'specs/shared.md', 'Content Shared');
    });
    afterAll(async () => {
      await rm(cloneDir, { recursive: true, force: true });
    });

    it('unions direct + enabled-skill docs, dedups by path with agent-direct position winning, and formats "Path: X\\n\\n<text>" (AC-14/15/16)', async () => {
      const app = await appWith();
      const agentId = await createAgent(app, 'Resolve Agent');
      const skillId = await createSkill(app, 'Resolve Skill');

      await app.inject({
        method: 'PUT',
        url: `/agents/${agentId}/context`,
        payload: { paths: ['specs/a.md', 'specs/shared.md'] },
      });
      await app.inject({
        method: 'PUT',
        url: `/skills/${skillId}/context`,
        payload: { paths: ['specs/shared.md', 'specs/b.md'] },
      });
      await app.container.agentsRepo.linkSkill(agentId, skillId, 0, true);

      const agentRow = await app.container.agentsRepo.getById(workspaceId, agentId);
      const service = new ContextService(app.container as unknown as Container);
      const ref = { owner: 'acme', name: 'doesnotmatter-for-tempclone' };
      const result = await service.resolveEffectiveSpecs(ref, agentRow!);

      // agent-direct order wins: a.md, shared.md (from direct), then b.md (only new one from skill).
      expect(result.read).toEqual(['specs/a.md', 'specs/shared.md', 'specs/b.md']);
      expect(result.skipped).toEqual([]);
      expect(result.specs[0]).toBe('Path: specs/a.md\n\nContent A');
      await app.close();
    });

    it('skips a doc whose path no longer resolves in the clone, without failing (AC-19)', async () => {
      const app = await appWith();
      const agentId = await createAgent(app, 'Skip Agent');

      await app.inject({
        method: 'PUT',
        url: `/agents/${agentId}/context`,
        payload: { paths: ['specs/a.md', 'specs/deleted-upstream.md'] },
      });

      const agentRow = await app.container.agentsRepo.getById(workspaceId, agentId);
      const service = new ContextService(app.container as unknown as Container);
      const ref = { owner: 'acme', name: 'doesnotmatter-for-tempclone' };
      const result = await service.resolveEffectiveSpecs(ref, agentRow!);

      expect(result.read).toEqual(['specs/a.md']);
      expect(result.skipped).toEqual(['specs/deleted-upstream.md']);
      await app.close();
    });
  });
});
