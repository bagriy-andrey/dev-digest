---
name: ui-architecture
version: 1.0.0
description: >
  React/Next.js frontend code organization and architecture — folder structure,
  feature modules, component splitting rules, where to put constants / utils /
  helpers / services / types, and business logic placement. Use when someone asks
  where a file should live, how to organize a feature, when to split a component,
  or how to structure a new module. Covers both feature-based (bulletproof-react
  style) and Feature-Sliced Design (FSD), with guidance on when to choose each.
  Trigger on questions like "where do I put X", "how should I structure Y",
  "should I split this component", "where does business logic go".
---

# UI Architecture — Code Organization

This skill answers **where things live**, not how to write them.

- For component design patterns (pure components, hooks misuse, state) → `react-best-practices`
- For Next.js file conventions (routing, RSC, metadata) → `next-best-practices`
- For TypeScript type-level programming → `typescript-expert`

---

## Folder Structure: Scale-Based Evolution

### Small (< 15 components, 1-2 devs)

Flat structure. Decision fatigue is the real enemy at this scale.

```
src/
├── components/   # all components
├── hooks/        # all custom hooks
├── utils/        # helpers + utilities
├── types/        # TypeScript types
└── constants/    # app-wide constants
```

### Medium (3-10 devs, 15-50 components)

Feature-based: group by domain, not by file type.

```
src/
├── components/       # shared UI only (Button, Input, Modal, Badge)
├── features/
│   └── auth/
│       ├── components/
│       ├── hooks/
│       ├── services/
│       ├── types/
│       ├── constants/
│       └── index.ts  # public API
├── hooks/            # cross-feature hooks
├── services/         # cross-feature API clients
├── utils/            # pure utilities
├── types/            # shared TypeScript types
└── constants/        # app-wide constants
```

### Large / Enterprise (10+ devs)

Feature-Sliced Design (FSD): stricter layer rules enforced by linter.

```
src/
├── app/          # routing, providers, global config, error boundaries
├── pages/        # page-level compositions (route → assembled widgets)
├── widgets/      # self-contained UI blocks (Sidebar, Header, Feed)
├── features/     # user-facing interactions (LoginForm, SearchBar)
├── entities/     # business objects (User, Product, Review)
└── shared/       # UI kit, utils, constants, API client, hooks
```

---

## Feature-Based vs FSD: When to Choose

| Axis             | Feature-Based         | FSD                          |
|------------------|-----------------------|------------------------------|
| Team size        | 3-15 devs             | 10+ devs                     |
| Learning curve   | Low                   | Medium                       |
| Dependency rules | Convention            | Enforced by linter           |
| Flexibility      | High                  | Constrained by design        |
| Best for         | Most SPA / SSR apps   | Large teams needing discipline |

**FSD key rule — unidirectional imports**: layers may only import from layers below them.

```
app → pages → widgets → features → entities → shared
```

Never import upward. A `feature` must never import from `pages` or `widgets`.

---

## Feature Module Anatomy

Each feature folder is a self-contained module with its own public API.

```
features/auth/
├── components/       # UI components used only within this feature
│   ├── LoginForm.tsx
│   └── AuthGuard.tsx
├── hooks/            # feature-specific logic
│   └── useLogin.ts
├── services/         # API calls for this feature
│   └── authApi.ts
├── types/            # TypeScript types
│   └── auth.types.ts
├── constants/        # feature-scoped constants
│   └── auth.constants.ts
└── index.ts          # public API — only export what other features need
```

**Rule**: never import from inside another feature's internal folders. Always go through `index.ts`.

```ts
// WRONG
import { useLogin } from '../auth/hooks/useLogin';

// CORRECT
import { useLogin } from '../auth';
```

---

## Component Splitting Rules

Split a component when ANY of the following is true:

1. **Size** — exceeds ~200 lines
2. **Multiple responsibilities** — renders AND fetches AND transforms data in one body
3. **Reuse** — the same JSX block appears in 2+ places
4. **Re-render scope** — a part updates frequently while the rest is stable
5. **Testability** — a chunk of logic is hard to test in isolation

Do NOT split when:
- The sub-component would only ever have one caller
- Splitting would require passing many props back up, creating tight coupling
- The pieces are too small to carry meaningful names

A split should result in components that can be reasoned about independently.

---

## Constants: Where They Live

**Rule**: if a constant is referenced from more than one file, extract it. If it only belongs to one component, keep it at the top of that file.

```ts
// Component-local — stays in the component file (no extraction needed)
const ANIMATION_DURATION_MS = 300;

// Feature-scoped — features/auth/constants/auth.constants.ts
export const MAX_LOGIN_ATTEMPTS = 5;
export const SESSION_TIMEOUT_MS = 30_000;

// App-wide — src/constants/routes.ts, src/constants/api.ts
export const ROUTES = {
  home: '/',
  login: '/login',
} as const;
```

For large apps, organize by category — one file per concern:

| File                      | Contents                              |
|---------------------------|---------------------------------------|
| `constants/routes.ts`     | Route path strings                    |
| `constants/api.ts`        | Endpoint prefixes, timeouts           |
| `constants/ui.ts`         | Breakpoints, animation durations      |
| `constants/errors.ts`     | Error codes, user-facing error messages |

---

## Utils vs Helpers — The Distinction

|                  | Utils                                     | Helpers                                    |
|------------------|-------------------------------------------|--------------------------------------------|
| **Portability**  | Project-agnostic — could live in lodash   | Project-specific — knows domain terms      |
| **Examples**     | `formatDate`, `clamp`, `debounce`         | `formatPRTitle`, `getReviewStatus`         |
| **Location**     | `src/utils/` or `shared/lib/`             | Inside the feature, or `src/helpers/`      |
| **Side effects** | None — pure functions only                | May have domain side effects               |

**Rule**: if a function would make sense in a completely different project, it's a util. If it references your domain vocabulary (reviews, PRs, users), it's a helper.

---

## Business Logic Placement

Prefer the lowest layer that can own the logic:

```
1. Pure function / util     — stateless transformation, no React needed
2. Custom hook              — stateful logic, side effects, subscriptions
3. Service module           — API calls, external integrations (plain TS, no hooks)
4. Context / store          — shared state needed by multiple unrelated subtrees
```

```ts
// 1. Service — plain TS, no React, fully testable without rendering
// features/reviews/services/reviewApi.ts
export async function fetchReview(id: string): Promise<Review> {
  const res = await apiClient.get(`/reviews/${id}`);
  return res.data;
}

// 2. Hook — orchestrates service + local state
// features/reviews/hooks/useReview.ts
export function useReview(id: string) {
  const [review, setReview] = useState<Review | null>(null);
  useEffect(() => { fetchReview(id).then(setReview); }, [id]);
  return review;
}

// 3. Component — only renders
// features/reviews/components/ReviewDetail.tsx
export function ReviewDetail({ id }: { id: string }) {
  const review = useReview(id);
  return <div>{review?.title}</div>;
}
```

**Anti-pattern**: business logic directly in a component body — makes it untestable and ties logic to a specific rendering context.

---

## TypeScript: Where Types Live

| Type category               | Location                                         |
|-----------------------------|--------------------------------------------------|
| Feature-specific types      | `features/<name>/types/<name>.types.ts`          |
| Shared business entities    | `types/` or `entities/<name>/model/` (FSD)       |
| Component props             | Inline in the component file (no separate file)  |
| API response shapes         | `services/` or `types/api.types.ts`              |
| Utility function signatures | Inline in the util file                          |

### interface vs type vs enum

- **`interface`** — for object shapes that might be extended (component props, API entities)
- **`type`** — for unions, intersections, mapped types, and aliases
- **`enum`** — when values are stored or compared at runtime
- **`const` object + `typeof` union** — prefer over `enum` for config flags (better tree-shaking)

```ts
// prefer this
export const ReviewStatus = { pending: 'pending', done: 'done' } as const;
export type ReviewStatus = typeof ReviewStatus[keyof typeof ReviewStatus];

// over this (emits runtime code, harder to tree-shake)
export enum ReviewStatus { pending = 'pending', done = 'done' }
```

Export types from the feature's `index.ts` if other features need them — treat them as part of the public API.

---

## Module Public APIs (index.ts)

Each feature/module exposes a single entry point. Other modules import ONLY from it.

```ts
// features/auth/index.ts
export { LoginForm } from './components/LoginForm';
export { useAuth } from './hooks/useAuth';
export type { AuthUser } from './types/auth.types';
// Do NOT re-export internal utils, constants, or helpers
```

**Barrel file caution**: feature-level barrels (`features/auth/index.ts`) are fine. Project-wide barrels (`src/index.ts` that re-exports everything) slow down Vite/webpack tree-shaking. Avoid global barrels.

---

## Colocation Principle

Code that changes together lives together.

- A component's dedicated hook → next to the component, not in a global `/hooks`
- A component's test → `Component.test.tsx` alongside `Component.tsx`
- Feature-specific types, constants, and helpers → inside the feature folder

Move something to `shared/` (or the top-level `utils/`, `types/`, `constants/`) only when it is genuinely used by **2+ unrelated features**.
