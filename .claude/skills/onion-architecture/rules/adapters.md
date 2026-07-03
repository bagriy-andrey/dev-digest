# Adapters

Adapters are the outer layer. They translate between the application's ports and the real world.
There are two kinds: **driving** (they call the application) and **driven** (the application calls them).

```
HTTP request ──► routes.ts (driving adapter) ──► service.ts ──► repository.ts (driven adapter) ──► Postgres
                                                             └──► github adapter (driven)          ──► GitHub API
```

## Driving adapters — `routes.ts`

Driving adapters receive external input (HTTP, jobs, SSE) and invoke the application service.

**Responsibilities:**
- Parse and validate the request (Zod schema via `fastify-type-provider-zod`)
- Extract identity from context (`req.requestContext`)
- Call the service method
- Map the result to an HTTP response

**Must NOT:**
- Contain business logic or domain decisions
- Call the database directly
- Know about other modules' internals

```ts
// GOOD — thin route handler
fastify.post('/', {
  schema: { body: AddRepoBody, response: { 201: RepoSchema, 200: RepoSchema } },
}, async (req, reply) => {
  const { workspaceId, userId } = req.requestContext;
  const { url } = req.body;
  const { repo, created } = await service.add(workspaceId, userId, url);
  return reply.status(created ? 201 : 200).send(repo);
});

// BAD — route with business logic
fastify.post('/', async (req, reply) => {
  const match = req.body.url.match(/github\.com\//); // ← domain logic here
  if (!match) return reply.status(400).send({ error: 'bad url' });
  const existing = await db.select()...              // ← DB call here
});
```

### Job handlers as driving adapters

`registerCloneJobHandler()` in `service.ts` (registering) + the actual job callback (invoking) is
also a driving adapter pattern — the job runner drives the application service.

## Driven adapters — `repository.ts` and `adapters/<technology>/`

Driven adapters are called by the application and implement a port interface.

### Repository (Drizzle)

```ts
// modules/repos/repository.ts
import { eq, and } from 'drizzle-orm';
import { repos } from '../../db/schema/repos.js';
import type { Db } from '../../db/client.js';

export class RepoRepository {
  constructor(private db: Db) {}

  async findByFullName(workspaceId: string, fullName: string) {
    const [row] = await this.db
      .select()
      .from(repos)
      .where(and(eq(repos.workspaceId, workspaceId), eq(repos.fullName, fullName)));
    return row ?? null;
  }
}
```

The repository knows about Drizzle and the schema — that's fine. It's an adapter.
What it must NOT do: validate business rules, call other services, emit side effects beyond persistence.

### External service adapters — `adapters/<technology>/`

Adapters for external APIs live in `adapters/` and implement a port from `@devdigest/shared`:

```ts
// adapters/github/octokit.ts
import { Octokit } from '@octokit/rest';
import type { GitHubClient } from '@devdigest/shared';

export class OctokitGitHubClient implements GitHubClient {
  private octokit: Octokit;
  constructor(token: string) {
    this.octokit = new Octokit({ auth: token });
  }
  // implements GitHubClient methods...
}
```

## Naming conventions

| Role | File | Class name pattern |
|------|------|--------------------|
| HTTP driving adapter | `modules/<name>/routes.ts` | (no class, just plugin fn) |
| Persistence driven adapter | `modules/<name>/repository.ts` | `<Name>Repository` |
| External API driven adapter | `adapters/<tech>/<name>.ts` | `<Tech><Name>` (e.g. `OctokitGitHubClient`) |

## Cross-module adapter access

Repositories for **cross-cutting** entities (agents, reviews) are constructed in `container.ts`
and accessed via `container.agentsRepo` / `container.reviewRepo`, NOT by reaching into another
module's folder. See [composition-root.md](composition-root.md) for details.
