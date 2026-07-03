# Module Structure

Every feature in `server/src/modules/<name>/` follows the same canonical layout.
Each file has a single, well-defined layer responsibility.

## Canonical layout

```
modules/<name>/
├── routes.ts      — HTTP adapter (driving). Fastify plugin. No business logic.
├── service.ts     — Application layer. Orchestrates domain + ports. No HTTP, no raw SQL.
├── repository.ts  — Persistence adapter (driven). Drizzle queries. No business logic.
├── helpers.ts     — Domain layer. Pure functions. No I/O, no framework imports.
├── constants.ts   — Literals only: job kind strings, limits, config keys.
└── types.ts       — Port interfaces + module-local types (add when needed).
```

Optional sub-structures (used in `reviews/`):
```
modules/<name>/
└── repository/
    ├── pull.repo.ts
    ├── review.repo.ts
    └── run.repo.ts
```

Split the repository when one file grows beyond ~150 lines of query logic.

## File responsibilities

### `routes.ts` — HTTP adapter

```ts
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { RepoService } from './service.js';

const AddRepoBody = z.object({ url: z.string().url() });

const plugin: FastifyPluginAsyncZod = async (fastify) => {
  const service = new RepoService(fastify.container);

  fastify.post('/', { schema: { body: AddRepoBody } }, async (req, reply) => {
    const { workspaceId, userId } = req.requestContext;
    const { repo, created } = await service.add(workspaceId, userId, req.body.url);
    return reply.status(created ? 201 : 200).send(repo);
  });
};

export default plugin;
```

Rules: parse input → delegate to service → shape HTTP response. Nothing else.

### `service.ts` — Application layer

```ts
export class RepoService {
  private repo: RepoRepository; // constructed here for now; move to container if shared

  constructor(private container: Container) {
    this.repo = new RepoRepository(container.db);
  }

  async add(workspaceId: string, userId: string, url: string) {
    const { owner, name } = parseRepoUrl(url);        // domain function
    const existing = await this.repo.findByFullName(workspaceId, `${owner}/${name}`);
    if (existing) return { repo: toRepoDto(existing), created: false };
    const row = await this.repo.insert({ workspaceId, owner, name, ... });
    await this.container.jobs.enqueue(workspaceId, CLONE_JOB_KIND, { ... });
    return { repo: toRepoDto(row), created: true };
  }
}
```

Rules: no `db.*` calls, no `fastify` imports, no `drizzle-orm` imports.

### `repository.ts` — Persistence adapter

```ts
import { eq, and } from 'drizzle-orm';
import { repos } from '../../db/schema/repos.js';
import type { Db } from '../../db/client.js';
import type { RepoRow, NewRepoRow } from '../../db/rows.js';

export class RepoRepository {
  constructor(private db: Db) {}

  async findByFullName(workspaceId: string, fullName: string): Promise<RepoRow | null> {
    const [row] = await this.db.select().from(repos)
      .where(and(eq(repos.workspaceId, workspaceId), eq(repos.fullName, fullName)));
    return row ?? null;
  }

  async insert(data: NewRepoRow): Promise<RepoRow> {
    const [row] = await this.db.insert(repos).values(data).returning();
    return row;
  }
}
```

Rules: Drizzle queries only. No business decisions. Return raw rows; let the service map to DTOs.

### `helpers.ts` — Domain layer (pure functions)

```ts
// No imports from framework/ORM/I-O
export function parseRepoUrl(url: string): { owner: string; name: string } { ... }
export function toRepoDto(row: RepoRow): Repo { ... }
export function withGitHubToken(url: string, token: string): string { ... }
```

### `constants.ts` — Literals

```ts
export const CLONE_JOB_KIND = 'repo:clone' as const;
export const CLONE_DEPTH = 1;
export const GITHUB_TOKEN_SECRET = 'GITHUB_TOKEN';
```

## Registration

Every module is registered with ONE import + ONE entry in `modules/index.ts`.
No filesystem autoload — registration is explicit and static.

```ts
// modules/index.ts
import repos from './repos/routes.js';

export function registerModules(fastify: FastifyInstance) {
  fastify.register(repos, { prefix: '/api/repos' });
}
```
