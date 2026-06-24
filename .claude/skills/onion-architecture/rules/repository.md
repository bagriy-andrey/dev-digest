# Repository Pattern with Drizzle ORM

The repository is a driven adapter: the application calls it, and it talks to Postgres via Drizzle.
Its job is to hide every Drizzle detail from the application layer.

**Location:** `modules/<name>/repository.ts` (or `modules/<name>/repository/*.repo.ts` when large)

## Rules

1. **Drizzle stays inside** — `drizzle-orm`, schema imports, and `db/client` never leak up
2. **No business logic** — no domain decisions, no validation, no side-effects beyond persistence
3. **Returns rows, not DTOs** — the service maps `RepoRow → Repo`; the repository just fetches
4. **One repository per aggregate** — don't mix tables from different aggregates in one class

## Anatomy of a repository

```ts
// modules/repos/repository.ts
import { eq, and, isNull } from 'drizzle-orm';
import { repos } from '../../db/schema/repos.js';
import type { Db } from '../../db/client.js';
import type { RepoRow, NewRepoRow } from '../../db/rows.js';

export class RepoRepository {
  constructor(private db: Db) {}

  async findByFullName(workspaceId: string, fullName: string): Promise<RepoRow | null> {
    const [row] = await this.db
      .select()
      .from(repos)
      .where(and(
        eq(repos.workspaceId, workspaceId),
        eq(repos.fullName, fullName),
        isNull(repos.deletedAt),
      ));
    return row ?? null;
  }

  async insert(data: NewRepoRow): Promise<RepoRow> {
    const [row] = await this.db.insert(repos).values(data).returning();
    return row;
  }

  async list(workspaceId: string): Promise<RepoRow[]> {
    return this.db
      .select()
      .from(repos)
      .where(and(eq(repos.workspaceId, workspaceId), isNull(repos.deletedAt)))
      .orderBy(repos.createdAt);
  }

  async updateClonePath(id: string, path: string): Promise<void> {
    await this.db.update(repos)
      .set({ clonePath: path, lastPolledAt: new Date() })
      .where(eq(repos.id, id));
  }

  async remove(workspaceId: string, id: string): Promise<boolean> {
    const result = await this.db.update(repos)
      .set({ deletedAt: new Date() })
      .where(and(eq(repos.id, id), eq(repos.workspaceId, workspaceId)));
    return (result.rowCount ?? 0) > 0;
  }
}
```

## Transactions

Use Drizzle's `db.transaction()` inside the repository. Expose a `withTransaction` method
when the service needs to compose multiple repository calls atomically:

```ts
// modules/reviews/repository.ts
async withTransaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
  return this.db.transaction((tx) => fn(tx as Db));
}

// usage in service.ts
await this.reviewRepo.withTransaction(async (tx) => {
  const txRepo = new ReviewRepository(tx);
  await txRepo.insertReview({ ... });
  await txRepo.insertFindings(reviewId, findings);
});
```

This keeps the transaction handle inside the adapter layer; the service never imports `drizzle-orm`.

## Row types vs domain types

`db/rows.ts` exports inferred Drizzle row types. These are OK inside the adapter layer
and in service-to-repository method signatures, but should be mapped to domain DTOs
before leaving the service:

```ts
// db/rows.ts (generated from schema)
export type RepoRow = typeof repos.$inferSelect;
export type NewRepoRow = typeof repos.$inferInsert;

// helpers.ts (domain) — maps row to domain DTO
export function toRepoDto(row: RepoRow): Repo { ... }

// service.ts — maps before returning to caller
return { repo: toRepoDto(row), created: true };
```

The HTTP route and any caller outside the module sees `Repo` (domain DTO), never `RepoRow`.

## Split repositories

When a module deals with multiple aggregates or a repository grows beyond ~150 lines:

```
modules/reviews/
└── repository/
    ├── pull.repo.ts    — PR rows (pulls table)
    ├── review.repo.ts  — review rows (reviews table)
    └── run.repo.ts     — run rows + findings (agent_runs, findings tables)
```

Each sub-repository still follows the same rules. The service imports them individually.

## What NOT to put in a repository

```ts
// BAD — business rule in repository
async findActiveRepos(workspaceId: string) {
  const rows = await this.db.select()...;
  return rows.filter(r => r.cloneStatus === 'ready' && !r.isArchived); // ← business rule
}

// GOOD — repository returns all matching rows, service filters
async list(workspaceId: string): Promise<RepoRow[]> {
  return this.db.select().from(repos).where(eq(repos.workspaceId, workspaceId));
}
// service.ts filters:
const active = rows.filter(r => r.cloneStatus === 'ready');
```

The "what counts as active" decision is domain logic, not a query detail.
