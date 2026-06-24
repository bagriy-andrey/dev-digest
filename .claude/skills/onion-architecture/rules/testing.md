# Testing Strategy by Layer

Each layer has a different testing approach. The key principle: test at the layer boundary
where the concern actually lives, and only mock what crosses that boundary.

## Overview

| Layer | Test type | Mocking | File suffix | Speed |
|-------|-----------|---------|-------------|-------|
| Domain (`helpers.ts`) | Pure unit | None | `.test.ts` | Fast |
| Application (`service.ts`) | Unit with mock adapters | `ContainerOverrides` + `mocks.ts` | `.test.ts` | Fast |
| Adapters / Repository | Integration (real DB) | None | `.it.test.ts` | Slower |
| HTTP (`routes.ts`) | Integration (Fastify inject) | Mock container | `.test.ts` | Fast |

## Domain layer — pure unit tests

No mocks, no setup, no teardown. Just input/output assertions:

```ts
// modules/repos/helpers.test.ts
import { describe, it, expect } from 'vitest';
import { parseRepoUrl, withGitHubToken } from './helpers.js';

describe('parseRepoUrl', () => {
  it('parses owner and name from HTTPS URL', () => {
    expect(parseRepoUrl('https://github.com/acme/my-repo')).toEqual({
      owner: 'acme', name: 'my-repo',
    });
  });

  it('strips .git suffix', () => {
    expect(parseRepoUrl('https://github.com/acme/my-repo.git')).toEqual({
      owner: 'acme', name: 'my-repo',
    });
  });

  it('throws InvalidRepoUrlError for non-GitHub URLs', () => {
    expect(() => parseRepoUrl('https://gitlab.com/foo/bar')).toThrow('InvalidRepoUrlError');
  });
});
```

Run: `pnpm exec vitest run --exclude '**/*.it.test.ts'`

## Application layer — unit tests with mock adapters

Inject mocks via `ContainerOverrides`. Test business decisions, not infrastructure:

```ts
// modules/repos/service.test.ts
import { describe, it, expect, vi } from 'vitest';
import { RepoService } from './service.js';
import { buildTestContainer } from '../../test/helpers/container.js';
import { mockGitClient } from '../../adapters/mocks.js';

describe('RepoService.add', () => {
  it('returns created=false when repo already exists', async () => {
    const existingRow = { id: '1', fullName: 'acme/repo', ... };
    const container = buildTestContainer({
      // Override only what the service touches
      git: mockGitClient(),
    });
    // Inject a mock repository directly into the service
    const service = new RepoService(container);
    vi.spyOn(service['repo'], 'findByFullName').mockResolvedValue(existingRow);

    const result = await service.add('ws-1', 'user-1', 'https://github.com/acme/repo');
    expect(result.created).toBe(false);
  });

  it('throws when URL is invalid', async () => {
    const container = buildTestContainer();
    const service = new RepoService(container);
    await expect(service.add('ws-1', 'user-1', 'not-a-url')).rejects.toThrow('InvalidRepoUrlError');
  });
});
```

Key: you're testing the *decision logic* (`created=false` on duplicate, error on bad URL),
not whether Drizzle ran the right SQL.

## Adapter (repository) layer — integration tests with real Postgres

These tests run against a real Postgres instance via testcontainers.
**Must use `.it.test.ts` suffix** — this is enforced by the unit/integration split.

```ts
// modules/repos/repository.it.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, stopPg, getDb } from '../../test/helpers/pg.js';
import { RepoRepository } from './repository.js';

let db: Db;
beforeAll(async () => { db = await startPg(); });
afterAll(async () => { await stopPg(); });

describe('RepoRepository', () => {
  it('inserts and retrieves a row', async () => {
    const repo = new RepoRepository(db);
    const row = await repo.insert({
      workspaceId: 'ws-test', owner: 'acme', name: 'repo', fullName: 'acme/repo',
    });
    const found = await repo.findByFullName('ws-test', 'acme/repo');
    expect(found?.id).toBe(row.id);
  });

  it('returns null for unknown repo', async () => {
    const repo = new RepoRepository(db);
    expect(await repo.findByFullName('ws-test', 'nobody/nothing')).toBeNull();
  });
});
```

Run: `pnpm exec vitest run .it.test` (uses real Postgres via testcontainers)

## HTTP layer — Fastify inject() tests

Test that routes parse input, call the service, and return the right HTTP shape.
Use Fastify's `inject()` to avoid a real network call:

```ts
// modules/repos/routes.test.ts
import { describe, it, expect } from 'vitest';
import { buildApp } from '../../test/helpers/app.js';

describe('POST /api/repos', () => {
  it('returns 201 on success', async () => {
    const app = await buildApp({ /* mock container */ });
    const res = await app.inject({
      method: 'POST',
      url: '/api/repos',
      payload: { url: 'https://github.com/acme/repo' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ fullName: 'acme/repo' });
  });

  it('returns 400 on invalid URL', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/repos',
      payload: { url: 'bad-url' },
    });
    expect(res.statusCode).toBe(400);
  });
});
```

## What to mock, and what not to

| What | Should mock? | Why |
|------|-------------|-----|
| DB / Drizzle | No — use `.it.test.ts` | Mocking DB behavior leads to false confidence |
| External API (GitHub, LLM) | Yes — via `ContainerOverrides` | Avoid real HTTP in unit/route tests |
| Job queue | Yes — spy on `container.jobs.enqueue` | Verify enqueue call, not job execution |
| Clock / `Date.now()` | Yes — via `vi.useFakeTimers()` | Deterministic timestamps |
| Domain functions | Never | They're pure; just call them |

## File suffix discipline

```
*.test.ts     — hermetic unit tests; runs fast, no external deps
*.it.test.ts  — integration tests; requires real Postgres via testcontainers
```

The CI runner separates these two groups. Never put a `db.*` call in a `*.test.ts` file.
