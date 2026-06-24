---
name: onion-architecture
description: "Enforces Onion Architecture (Ports & Adapters / Clean Architecture) for DevDigest backend modules. Use when adding a new feature module, refactoring a service, designing a repository, wiring a new adapter, or deciding where a piece of logic belongs. Trigger terms: onion, clean architecture, hexagonal, ports, adapters, dependency rule, domain layer, application layer, repository pattern, DI container, composition root."
allowed-tools: Read, Write, Edit, Bash, Grep, Glob
---

# Onion Architecture — DevDigest Backend

Enforces clean separation of concerns across the `server/` package.
The architecture has four concentric layers; **dependencies point inward only** — the single non-negotiable rule.

```
┌─────────────────────────────────────────┐
│  Infrastructure / Adapters              │  routes.ts · repository.ts · adapters/
│  ┌───────────────────────────────────┐  │
│  │  Application                      │  │  service.ts
│  │  ┌─────────────────────────────┐  │  │
│  │  │  Domain                     │  │  │  helpers.ts · pure types · errors
│  │  └─────────────────────────────┘  │  │
│  └───────────────────────────────────┘  │
└─────────────────────────────────────────┘
         ↑ dependencies only flow inward
```

## When to use this skill

- Adding a new feature module (`modules/<name>/`)
- Writing or reviewing a service, repository, or route handler
- Deciding where a piece of logic belongs
- Designing an interface (port) for an external dependency
- Wiring a new external adapter into the DI container
- Writing tests and choosing what to mock

## Reading order by scenario

| Scenario | Read |
|----------|------|
| New feature module | `layers.md` → `module-structure.md` → `domain.md` → `application.md` → `repository.md` |
| Adding an external integration | `ports.md` → `adapters.md` → `composition-root.md` |
| "Where does this code go?" | `dependency-rule.md` → `layers.md` |
| Writing tests | `testing.md` |
| Refactoring a bloated service | `domain.md` → `application.md` → `dependency-rule.md` |

## Anti-pattern quick-check

Before any commit, verify:

- [ ] `service.ts` does NOT import from `drizzle-orm`, `db/schema`, or `fastify`
- [ ] `repository.ts` does NOT contain business logic — only queries
- [ ] `routes.ts` does NOT call `db.*` directly
- [ ] No `new ConcreteAdapter()` inside a service — only inside `container.ts`
- [ ] Every external dependency has a TypeScript interface (port) the service depends on
- [ ] New adapters have integration tests (`.it.test.ts`); domain logic has unit tests

## Rule files

- [rules/layers.md](rules/layers.md) — Layer definitions, what belongs where, import table
- [rules/dependency-rule.md](rules/dependency-rule.md) — The single rule: dependencies point inward only
- [rules/ports.md](rules/ports.md) — How to define TypeScript interfaces as ports
- [rules/adapters.md](rules/adapters.md) — Driving vs driven adapters; Fastify routes, Drizzle repos, external clients
- [rules/composition-root.md](rules/composition-root.md) — `container.ts` — wiring, lazy init, overrides
- [rules/module-structure.md](rules/module-structure.md) — Canonical `modules/<name>/` layout
- [rules/domain.md](rules/domain.md) — Domain logic: pure functions, value objects, domain errors
- [rules/application.md](rules/application.md) — Application services / use-cases
- [rules/repository.md](rules/repository.md) — Repository pattern with Drizzle ORM
- [rules/testing.md](rules/testing.md) — Testing strategy per layer

## References

See [references.md](references.md) for source articles and further reading.
