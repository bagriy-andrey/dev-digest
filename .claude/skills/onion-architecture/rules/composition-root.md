# Composition Root

The composition root is the single place in the application that knows about every concrete
class and wires them together. In DevDigest this is `platform/container.ts`.

**Rule:** `new ConcreteAdapter()` belongs in `container.ts` only. If you write it anywhere else, move it.

## What the Container does

```ts
// platform/container.ts
export class Container {
  // 1. Holds config and the DB connection (infrastructure primitives)
  readonly config: AppConfig;
  readonly db: Db;

  // 2. Eagerly constructs always-needed infrastructure
  readonly secrets: SecretsProvider;  // = new LocalSecretsProvider(...)
  readonly auth: AuthProvider;        // = new LocalNoAuthProvider(...)
  readonly jobs: JobRunner;
  readonly runBus: RunBus;

  // 3. Lazily constructs expensive or secret-dependent adapters
  get git(): GitClient { this._git ??= new SimpleGitClient(...); return this._git; }
  get agentsRepo(): AgentsRepository { ... }
  async github(): Promise<GitHubClient> { /* resolves secret first */ }
  async llm(id): Promise<LLMProvider> { /* resolves secret, caches */ }
}
```

## Lazy initialization pattern

Use `??=` for adapters that are cheap to construct but not always needed:

```ts
private _codeIndex?: CodeIndex;

get codeIndex(): CodeIndex {
  if (this.overrides.codeIndex) return this.overrides.codeIndex;
  this._codeIndex ??= new RipgrepCodeIndex(this.git);
  return this._codeIndex;
}
```

Use `async` getters for adapters that need a secret:

```ts
async github(): Promise<GitHubClient> {
  if (this.overrides.github) return this.overrides.github;
  if (this._github) return this._github;
  const token = await this.secrets.get('GITHUB_TOKEN');
  if (!token) throw new ConfigError('GITHUB_TOKEN is not configured');
  this._github = new OctokitGitHubClient(token);
  return this._github;
}
```

## ContainerOverrides — test injection

`ContainerOverrides` is the mechanism for injecting mock adapters in tests.
It works because services depend on interfaces, not concrete classes:

```ts
// tests
import { mockGitClient, mockGitHubClient } from '../adapters/mocks.js';

const container = new Container(testConfig, db, {
  git: mockGitClient(),
  github: mockGitHubClient(),
  repoIntel: { getRepoMap: async () => ({ files: [] }) },
});
const service = new RepoService(container);
```

**The override always wins.** Every getter checks `this.overrides.X` before constructing.
This is pure DI without a framework — zero decorators, zero reflection overhead.

## Cross-cutting shared repositories

Repositories for entities used by multiple modules live on the container,
not in any specific module's folder:

```ts
// GOOD — accessed via container
container.agentsRepo   // AgentsRepository
container.reviewRepo   // ReviewRepository

// BAD — reaching into another module
import { AgentsRepository } from '../agents/repository.js'; // ← cross-module coupling
```

This prevents circular dependencies and keeps module boundaries clean.

## When to add something to the Container

Add to the container when:
- It's a concrete implementation of a port interface
- It needs a secret or config value to construct
- It's shared across multiple modules
- Tests need to replace it with a mock

Do NOT add to the container:
- Pure functions (domain helpers) — just import them directly
- Value objects or DTOs — construct them inline
- Stateless utilities — pass them as arguments if needed
