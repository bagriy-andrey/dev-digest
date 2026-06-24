# Application Layer

The application layer orchestrates domain logic and ports to fulfill use-cases.
It is the *what*, not the *how*: it decides what needs to happen, and delegates
to ports (interfaces) for every external interaction.

**Location:** `modules/<name>/service.ts`

## Rules

1. **No HTTP** — no `Request`, `Reply`, `FastifyInstance`, status codes, headers
2. **No raw SQL / ORM** — no `db.*`, no `drizzle-orm`, no `eq()`, no schema imports
3. **No framework construction** — no `new OctokitGitHubClient()`, no `new SimpleGitClient()`
4. **Depends on interfaces** — receives ports via constructor (DI), not concrete classes
5. **Owns business decisions** — validation, authorization, orchestration, error mapping

## Anatomy of a service

```ts
// modules/repos/service.ts

import type { Container } from '../../platform/container.js';
import type { Repo } from '@devdigest/shared';
import { NotFoundError } from '../../platform/errors.js';
import { RepoRepository } from './repository.js';
import { parseRepoUrl, withGitHubToken, toRepoDto } from './helpers.js';
import { CLONE_JOB_KIND, CLONE_DEPTH, GITHUB_TOKEN_SECRET } from './constants.js';

export class RepoService {
  private repo: RepoRepository;

  constructor(private container: Container) {
    // Repository constructed here when module-local. If shared across modules,
    // it belongs on the container (see composition-root.md).
    this.repo = new RepoRepository(container.db);
  }

  async add(workspaceId: string, userId: string, url: string): Promise<{ repo: Repo; created: boolean }> {
    // 1. Domain: parse and validate input
    const { owner, name } = parseRepoUrl(url);    // throws InvalidRepoUrlError if bad
    const fullName = `${owner}/${name}`;

    // 2. Application: deduplication rule
    const existing = await this.repo.findByFullName(workspaceId, fullName);
    if (existing) return { repo: toRepoDto(existing), created: false };

    // 3. Application: persist + enqueue side-effect
    const row = await this.repo.insert({ workspaceId, owner, name, fullName, createdBy: userId });
    await this.container.jobs.enqueue(workspaceId, CLONE_JOB_KIND, { repoId: row.id, owner, name, url });

    // 4. Domain: map to DTO before returning
    return { repo: toRepoDto(row), created: true };
  }
}
```

## Application layer patterns

### Use-case per method, not per class

One service class per feature module is typically enough. Each public method is one use-case:

```ts
export class RepoService {
  async add(...)     // use-case: register a new repository
  async list(...)    // use-case: list workspace repositories
  async refresh(...) // use-case: trigger re-clone
  async remove(...)  // use-case: delete a repository
}
```

Avoid one-method classes like `AddRepoUseCase` unless the module grows very large.

### Job handlers as application orchestration

When a background job needs business logic, register and implement the handler in the service:

```ts
registerCloneJobHandler(): void {
  this.container.jobs.register(CLONE_JOB_KIND, async (payload) => {
    await this.runCloneJob(payload as CloneJobPayload);
  });
}

async runCloneJob(payload: CloneJobPayload): Promise<void> {
  // Application orchestration: authenticate, clone, persist, kick off indexing
  const token = await this.container.secrets.get(GITHUB_TOKEN_SECRET);
  const cloneUrl = token ? withGitHubToken(payload.url, token) : payload.url;
  const { path } = await this.container.git.clone(...);  // port call
  await this.repo.updateClonePath(payload.repoId, path); // port call
}
```

### Error handling

The service throws **domain or application errors** — never HTTP errors:

```ts
// GOOD
if (!repo) throw new NotFoundError('Repo not found');

// BAD — HTTP concern in application layer
if (!repo) throw fastify.httpErrors.notFound('Repo not found');
```

HTTP status codes are assigned in `routes.ts` or the global error handler in `app.ts`.

### Transactions

When multiple port calls must be atomic, receive a transaction handle through the port:

```ts
// Hypothetical — unit-of-work via port
async transferPR(fromId: string, toId: string): Promise<void> {
  await this.repo.withTransaction(async (tx) => {
    await tx.remove(fromId);
    await tx.insert({ ... });
  });
}
```

The `withTransaction` method lives in the repository (adapter); the service only calls it.
See [repository.md](repository.md) for the Drizzle implementation.
