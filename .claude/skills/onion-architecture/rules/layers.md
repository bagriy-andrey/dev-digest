# Layers

Four concentric layers. Each layer may only import from layers **inside** it.

## Layer definitions

### 1. Domain (innermost)
Pure business logic. No I/O, no framework, no ORM.

**Lives in:** `modules/<name>/helpers.ts`, pure type files, domain error classes  
**Contains:** value objects, entity types, pure transformation functions, domain-specific errors  
**Allowed imports:** TypeScript stdlib, `@devdigest/shared` Zod contracts, other domain-layer files  
**Forbidden imports:** `fastify`, `drizzle-orm`, `db/schema`, `db/client`, `adapters/`, `platform/container`

```ts
// GOOD — pure domain function in helpers.ts
export function parseRepoUrl(url: string): { owner: string; name: string } {
  const match = url.match(/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (!match) throw new DomainError(`Invalid GitHub URL: ${url}`);
  return { owner: match[1], name: match[2] };
}

// BAD — domain function that leaks infrastructure
import { db } from '../../db/client.js'; // ← FORBIDDEN in domain layer
```

### 2. Application
Orchestration of domain logic via ports (interfaces). Knows *what* to do, not *how*.

**Lives in:** `modules/<name>/service.ts`  
**Contains:** use-cases, business workflows, port interface consumption  
**Allowed imports:** domain layer, port interfaces from `@devdigest/shared` or local `types.ts`  
**Forbidden imports:** `drizzle-orm`, `db/schema`, `db/client`, `fastify`, concrete adapter classes

```ts
// GOOD — service depends on interfaces, not implementations
export class RepoService {
  constructor(private container: Container) {} // container holds interfaces

  async add(workspaceId: string, userId: string, url: string) {
    const { owner, name } = parseRepoUrl(url); // domain function
    return this.repo.findByFullName(workspaceId, `${owner}/${name}`); // port call
  }
}

// BAD — service reaches into infrastructure
import { db } from '../../db/client.js'; // ← FORBIDDEN
import { repos } from '../../db/schema/repos.js'; // ← FORBIDDEN
```

### 3. Adapters (Infrastructure)
Implements ports. Knows *how* to talk to Postgres, GitHub, filesystem, etc.

**Lives in:** `modules/<name>/repository.ts`, `adapters/<technology>/`, `modules/<name>/routes.ts`  
**Contains:** Drizzle queries, HTTP handlers, external API clients  
**Allowed imports:** everything, including `drizzle-orm`, `db/schema`, `fastify`, npm packages  
**Must implement:** interfaces defined in application or `@devdigest/shared`

Two sub-types — see [adapters.md](adapters.md) for detail:
- **Driving adapters** (`routes.ts`) — translate HTTP → application service call
- **Driven adapters** (`repository.ts`, `adapters/llm/`) — application calls out to infrastructure

### 4. Composition Root (outermost)
The single place that knows about every concrete class and wires them together.

**Lives in:** `platform/container.ts` exclusively  
**Contains:** `new ConcreteAdapter()`, lazy getters, `ContainerOverrides` for tests  
**Rule:** if you write `new SomeAdapter()` anywhere other than `container.ts`, it's a violation

## Import permission table

| File | Can import from | Cannot import from |
|------|----------------|--------------------|
| `helpers.ts` (domain) | `@devdigest/shared`, other helpers | `db/*`, `adapters/*`, `platform/*`, `fastify` |
| `service.ts` (application) | domain, port interfaces, `platform/container` (for DI) | `db/schema`, `drizzle-orm`, `fastify`, concrete adapters |
| `repository.ts` (adapter) | `db/schema`, `drizzle-orm`, domain types | Other modules' repositories directly |
| `routes.ts` (adapter) | `fastify`, `service.ts`, shared schemas | `db/*`, `drizzle-orm` |
| `container.ts` (composition) | everything | — (it's the composition root) |
