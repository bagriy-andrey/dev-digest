# References

Source articles and further reading for the Onion Architecture skill.

## Core theory

- [Layers, Onions, Ports, Adapters: it's all the same — ploeh blog](https://blog.ploeh.dk/2013/12/03/layers-onions-ports-adapters-its-all-the-same/)
  The canonical post explaining that Clean Architecture, Hexagonal, Onion, and Ports & Adapters
  are variations on the same idea: dependencies point inward.

- [Hexagonal Architecture: A Complete Guide with TypeScript Example](https://generalistprogrammer.com/tutorials/hexagonal-architecture-complete-guide)
  Thorough walkthrough of driving vs driven ports, with TypeScript code examples.

## TypeScript / Node.js implementations

- [Clean Architecture with TypeScript: DDD, Onion — André Bazaglia](https://bazaglia.com/clean-architecture-with-typescript-ddd-onion/)
  Practical DDD + Onion in TypeScript. Good coverage of value objects and port design.

- [Clean Node.js Architecture — Khalil Stemmler](https://khalilstemmler.com/articles/enterprise-typescript-nodejs/clean-nodejs-architecture/)
  Enterprise-grade TypeScript layering. Includes domain errors, application services, and
  infrastructure adapters.

- [SOLID + Onion Architecture in Node.js + InversifyJS — DEV.to](https://dev.to/remojansen/implementing-the-onion-architecture-in-nodejs-with-typescript-and-inversifyjs-10ad)
  Decorator-based DI approach. We use pure DI (no decorators) but the layering concepts apply.

- [Onion Architecture in Node.js with TypeScript — Medium](https://sankhadip.medium.com/onion-architecture-in-node-js-with-typescript-5508612a4391)
  Step-by-step implementation guide for Node.js.

- [Typesafe Zero-Cost DI in TypeScript — DEV.to](https://dev.to/vad3x/typesafe-almost-zero-cost-dependency-injection-in-typescript-112)
  Pure DI pattern (no framework), matching our `Container` + `ContainerOverrides` approach.

## Repository pattern

- [Atomic Repositories in Clean Architecture and TypeScript — Sentry Blog](https://blog.sentry.io/atomic-repositories-in-clean-architecture-and-typescript/)
  Transactions and the unit-of-work problem in clean architecture. Relevant for our `withTransaction` pattern.

- [Repository Pattern with Drizzle ORM in NestJS — Medium](https://medium.com/@vimulatus/repository-pattern-in-nest-js-with-drizzle-orm-e848aa75ecae)
  Drizzle-specific repository implementation. NestJS DI but the Drizzle patterns transfer directly.

- [Transactions with DDD and Repository Pattern in TypeScript — Medium](https://medium.com/@joaojbs199/transactions-with-ddd-and-repository-pattern-in-typescript-a-guide-to-good-implementation-part-2-da0af3e10901)
  Unit of work + transaction scope across multiple repositories.

## Fastify-specific

- [Fastify Clean Architecture boilerplate — GitHub](https://github.com/revell29/fastify-clean-architecture)
  Reference project: Fastify + TypeScript following DDD + Clean Architecture principles.

- [Fastify TypeScript docs](https://fastify.dev/docs/latest/Reference/TypeScript/)
  Official Fastify TypeScript integration — relevant for typing route schemas and plugins.
