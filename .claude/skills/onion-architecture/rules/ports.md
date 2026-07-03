# Ports (Interfaces)

A **port** is a TypeScript interface that the application layer depends on.
It defines *what* the application needs without specifying *how* it's done.
Adapters (outer layer) implement ports; the application never imports adapters directly.

## Where ports live in DevDigest

### Canonical location: `@devdigest/shared` (vendored)

`server/src/vendor/shared/` is the vendored copy of `@devdigest/shared`.
It contains port interfaces used across packages:

```ts
// vendor/shared/index.ts — core ports already defined
export interface GitHubClient { ... }
export interface GitClient { ... }
export interface LLMProvider { ... }
export interface Embedder { ... }
export interface SecretsProvider { ... }
export interface AuthProvider { ... }
export interface CodeIndex { ... }
```

These are the ports the application layer depends on. The concrete adapters
(`OctokitGitHubClient`, `SimpleGitClient`, etc.) live in `adapters/` and implement them.

### Module-local ports: `modules/<name>/types.ts`

For ports that are local to one feature module (e.g., a repository interface),
define them in a `types.ts` file inside the module:

```ts
// modules/repos/types.ts
export interface RepoPort {
  findByFullName(workspaceId: string, fullName: string): Promise<RepoRow | null>;
  insert(data: NewRepoRow): Promise<RepoRow>;
  list(workspaceId: string): Promise<RepoRow[]>;
  getById(workspaceId: string, id: string): Promise<RepoRow | null>;
  updateClonePath(id: string, path: string): Promise<void>;
  remove(workspaceId: string, id: string): Promise<boolean>;
  workspaceIdFor(repoId: string): Promise<string | null>;
}
```

The service receives `RepoPort`, not `RepoRepository`.
The `RepoRepository` class implements `RepoPort` in the adapter layer.

## Designing a port

### Keep ports narrow

A port should only expose what the application actually calls. Don't copy-paste all Drizzle methods.

```ts
// GOOD — narrow port, only what the service needs
export interface RepoPort {
  findByFullName(workspaceId: string, fullName: string): Promise<RepoRow | null>;
  insert(data: NewRepoRow): Promise<RepoRow>;
}

// BAD — leaks infrastructure details
export interface RepoPort {
  db: DrizzleDb;                              // ← infrastructure type in port
  query: typeof db.query;                    // ← ORM API in port
  schema: typeof repos;                      // ← schema in port
}
```

### Use domain types in port signatures, not DB row types

If a row type from `db/rows.ts` leaks into the port, application tests must know about Drizzle.
Prefer mapping to a domain/DTO type at the adapter boundary:

```ts
// Acceptable for internal modules (row types are lightweight)
export interface RepoPort {
  findByFullName(...): Promise<RepoRow | null>; // RepoRow from db/rows.ts is OK
}

// Ideal for ports that cross package boundaries
export interface RepoPort {
  findByFullName(...): Promise<Repo | null>; // Repo = domain/shared DTO
}
```

In DevDigest, `toRepoDto()` in `helpers.ts` converts `RepoRow → Repo` at the service boundary.

## `ContainerOverrides` — the port-to-mock bridge

`platform/container.ts` exposes `ContainerOverrides` so tests can inject mock implementations
of any port without touching the real adapters:

```ts
// test setup
const container = new Container(config, db, {
  github: mockGitHubClient,   // implements GitHubClient port
  git: mockGitClient,         // implements GitClient port
  repoIntel: mockRepoIntel,   // implements RepoIntel port
});
```

This only works because services depend on the interfaces, not the concrete classes.
If a service hardcodes `new OctokitGitHubClient()`, `ContainerOverrides` can't help.

## When to add a new port

Add a port whenever:
1. The application layer needs to call something external (DB, HTTP API, filesystem, clock)
2. You need to test the application layer without the real infrastructure
3. There are (or could be) multiple implementations (e.g., OpenAI vs Anthropic vs OpenRouter)

Do NOT add a port for:
- Pure in-process computation (math, string transforms) — that's domain logic, not a port
- Intra-module calls within the same layer
