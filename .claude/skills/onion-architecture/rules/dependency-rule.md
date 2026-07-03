# The Dependency Rule

> **Source code dependencies must point inward only.**
> Nothing in an inner layer can know anything about an outer layer.

This is the single non-negotiable constraint. Every other rule in this skill is a consequence of it.

## What "inward" means

```
Domain ← Application ← Adapters ← Composition Root
```

- Domain knows nothing about Application, Adapters, or Composition Root
- Application knows nothing about Adapters or Composition Root
- Adapters know nothing about Composition Root internals (only receive via DI)
- Composition Root knows everything (it's the wiring layer)

## How to detect violations

### Violation 1 — Service imports from infrastructure

```ts
// BAD: service.ts
import { db } from '../../db/client.js';         // ← infrastructure in application layer
import { repos } from '../../db/schema/repos.js'; // ← infrastructure in application layer
import { eq } from 'drizzle-orm';                 // ← infrastructure in application layer

export class RepoService {
  async list(workspaceId: string) {
    return db.select().from(repos).where(eq(repos.workspaceId, workspaceId));
  }
}
```

**Fix:** extract a `RepoRepository` that implements an interface; service calls the interface.

### Violation 2 — Route handler contains business logic

```ts
// BAD: routes.ts
fastify.post('/repos', async (req, reply) => {
  const { url } = req.body;
  const match = url.match(/github\.com\/([^/]+)\/([^/]+)/); // ← domain logic in adapter
  if (!match) return reply.status(400).send({ error: 'invalid url' });
  const existing = await db.select()...  // ← persistence in HTTP layer
});
```

**Fix:** URL parsing → `helpers.ts` (domain). DB call → `service.ts` (application) via `repository.ts` (adapter).

### Violation 3 — Domain function depends on framework type

```ts
// BAD: helpers.ts
import type { FastifyRequest } from 'fastify'; // ← framework type in domain layer

export function extractUser(req: FastifyRequest) { ... }
```

**Fix:** extract only the data you need from the request in `routes.ts`; pass plain values to domain.

### Violation 4 — `new ConcreteAdapter()` outside container

```ts
// BAD: service.ts
import { OctokitGitHubClient } from '../../adapters/github/octokit.js';

export class PullsService {
  private github = new OctokitGitHubClient(token); // ← construction in wrong layer
}
```

**Fix:** receive `GitHubClient` (interface) via constructor from the container.

## The dependency inversion trick

When an inner layer needs to call an outer layer (e.g., service needs to write to DB), invert:

1. Define an interface (port) in the inner layer (or `@devdigest/shared`)
2. Implement it in the outer layer (adapter)
3. Wire them in the composition root (container)

```
Application layer:   interface RepoPort { findByFullName(...): Promise<RepoRow | null> }
Adapter layer:       class RepoRepository implements RepoPort { ... drizzle queries ... }
Composition root:    service = new RepoService(new RepoRepository(db))
```

The inner layer never imports the outer — the outer imports the inner interface.

## Practical test

For any import in your code, ask: "Does this import bring knowledge of an outer layer into an inner layer?"

- `service.ts` imports `db/schema` → **violation** (outer → inner import direction reversed)
- `repository.ts` imports `db/schema` → **ok** (adapter imports infrastructure — same layer or outer)
- `routes.ts` imports `service.ts` → **ok** (adapter drives application)
- `service.ts` imports interface from `@devdigest/shared` → **ok** (inner imports inner/shared)
