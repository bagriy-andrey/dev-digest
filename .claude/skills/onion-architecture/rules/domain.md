# Domain Layer

The domain layer is the innermost ring. It contains the **pure business logic** of the application —
things that are true regardless of whether you use Fastify, Drizzle, GitHub, or any other technology.

**Location:** `modules/<name>/helpers.ts`, standalone type files, domain error classes.

## Rules

1. **No I/O** — no `fetch`, no `db.*`, no filesystem reads, no `setTimeout`
2. **No framework imports** — no `fastify`, `drizzle-orm`, `@octokit/*`, etc.
3. **No side effects** — same input always produces same output
4. **Only imports:** TypeScript stdlib, `@devdigest/shared` Zod contracts, other domain helpers

## What belongs here

### Pure transformation functions

```ts
// helpers.ts
import type { RepoRow } from '../../db/rows.js';
import type { Repo } from '@devdigest/shared';

// DTO mapping — pure transform, no I/O
export function toRepoDto(row: RepoRow): Repo {
  return {
    id: row.id,
    fullName: row.fullName,
    owner: row.owner,
    name: row.name,
    cloneStatus: row.cloneStatus,
    createdAt: row.createdAt.toISOString(),
  };
}

// URL parsing — domain rule about what constitutes a valid repo URL
export function parseRepoUrl(url: string): { owner: string; name: string } {
  const match = url.match(/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?(?:\/.*)?$/);
  if (!match) throw new InvalidRepoUrlError(url);
  return { owner: match[1], name: match[2] };
}

// Pure string transform — builds authenticated clone URL
export function withGitHubToken(url: string, token: string): string {
  return url.replace('https://', `https://${token}@`);
}
```

### Value objects

Small, immutable wrappers that carry a domain concept with validation:

```ts
// Hypothetical — if we needed a strongly typed RepoFullName
export class RepoFullName {
  readonly owner: string;
  readonly name: string;

  constructor(raw: string) {
    const [owner, name] = raw.split('/');
    if (!owner || !name) throw new InvalidRepoUrlError(raw);
    this.owner = owner;
    this.name = name;
  }

  toString() { return `${this.owner}/${this.name}`; }
}
```

In practice, DevDigest uses plain strings + `parseRepoUrl()` instead of value objects —
both are valid; choose value objects when the concept travels widely or has multiple rules.

### Domain errors

```ts
// domain errors carry domain meaning, not HTTP status codes
export class InvalidRepoUrlError extends Error {
  constructor(url: string) {
    super(`"${url}" is not a valid GitHub repository URL`);
    this.name = 'InvalidRepoUrlError';
  }
}

export class RepoDuplicateError extends Error {
  constructor(fullName: string) {
    super(`Repository "${fullName}" already exists in this workspace`);
    this.name = 'RepoDuplicateError';
  }
}
```

Domain errors are mapped to HTTP status codes in `routes.ts` or a global error handler —
never inside the domain itself.

## What does NOT belong here

| Code | Correct location |
|------|-----------------|
| `db.select().from(repos)` | `repository.ts` (adapter) |
| `fastify.register(...)` | `routes.ts` (adapter) |
| `container.github()` | `service.ts` (application) |
| `await fetch(...)` | `adapters/<name>` |
| `process.env.*` | `platform/config.ts` |

## Testing domain code

Domain functions are the easiest to test — no mocks needed:

```ts
import { describe, it, expect } from 'vitest';
import { parseRepoUrl, withGitHubToken } from './helpers.js';

describe('parseRepoUrl', () => {
  it('parses owner and name', () => {
    expect(parseRepoUrl('https://github.com/acme/my-repo')).toEqual({
      owner: 'acme',
      name: 'my-repo',
    });
  });

  it('throws on invalid URL', () => {
    expect(() => parseRepoUrl('not-a-github-url')).toThrow(InvalidRepoUrlError);
  });
});
```

Run with `pnpm exec vitest run` (no `.it.test.ts` suffix needed — no DB involved).
