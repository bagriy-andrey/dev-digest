# client (@devdigest/web) — module map

The DevDigest studio: import repos, browse PRs, run/read reviews, author agents.
Next.js 15 App Router + React 19, data via TanStack Query. Depth: `client/README.md`.

## Local commands
`pnpm dev` (:3000) · `pnpm build` · `pnpm start` · `pnpm typecheck` · `pnpm test` (vitest + jsdom)

## Conventions (non-default)
- All server data goes through `src/lib/hooks/*` (TanStack Query) → `src/lib/api.ts`.
  Don't `fetch` the API directly from a component or hand-roll query state.
- API base is `NEXT_PUBLIC_API_BASE` (default `http://localhost:3001`), read in `lib/api.ts`.
- UI primitives are vendored: import from `@devdigest/ui` (`src/vendor/ui`), not from a
  random component file. Contracts come from `@devdigest/shared` (`src/vendor/shared`).
- User-facing strings are i18n: add keys to `messages/<locale>/*.json` (next-intl); don't
  hard-code copy in components.
- Path aliases: `@/*` → `src/*`, plus the two vendored aliases above.
- Tests mock `fetch` — they run with no API and no network (vitest + jsdom).

## Gotchas
- Server vs Client components: data hooks (TanStack Query) only run in Client components.
- `src/vendor/shared` is a COPY of the server's contracts (vendored, not npm) — if a contract
  changes server-side, mirror it here or types drift silently.

## Do NOT touch
- `src/vendor/shared/*` and `src/vendor/ui/*` — vendored; treat as upstream, don't fork locally.
- `.next/` — build output (git-ignored).

## Pointers — read on demand
- `client/README.md` — UI route map + which API each route leans on (source of truth).
- `src/vendor/ui/README.md` — read when reaching for a UI primitive before building a new one.
- `client/docs/` — read when … (deep design notes; currently empty).
- `client/specs/` — read BEFORE implementing a feature/screen that has a spec here.
- `client/insights.md` — read when debugging this module; APPEND a line after a non-obvious fix.
