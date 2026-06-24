# ui-architecture skill

**Version**: 1.0.0
**Scope**: React / Next.js frontend code organization and architecture

---

## Focus

This skill answers **where things live** in a frontend codebase, not how to write them. It is intentionally scoped to structural decisions:

- Folder structure (scale-based evolution, feature-based, FSD)
- When and how to split components
- Where constants belong (component-local → feature-scoped → app-wide)
- Utils vs helpers: distinction and placement rules
- Business logic layers: utils → hooks → services → context/store
- TypeScript: where to put types, interfaces, enums
- Feature module public APIs (`index.ts` barrel rules)

---

## Related Skills & Differences

| Skill | What it covers | What it does NOT cover |
|---|---|---|
| **ui-architecture** (this) | Where files and folders go; structural decisions | How to write components or hooks |
| **react-best-practices** | Component design patterns, state, hooks misuse, performance | Folder structure or file organization |
| **next-best-practices** | Next.js routing, RSC boundaries, async APIs, metadata | Feature module layout or code organization |
| **typescript-expert** | Type-level programming, advanced TS patterns | Where types files live |
| **react-testing-library** | Test setup, RTL queries, mocking | Test file colocation (handled here) |

---

## When to invoke

Trigger phrases: "where do I put", "how to structure", "should I split this", "where does X live", "folder for", "organize feature", "utils or helpers", "where is business logic", "what goes in shared".

---

## Research Sources

### Folder Structure & General Organization

- [React Folder Structure Best Practices [2026] — Robin Wieruch](https://www.robinwieruch.de/react-folder-structure/) — canonical evolving guide: small → medium → large
- [How To Structure React Projects From Beginner To Advanced — WebDevSimplified](https://blog.webdevsimplified.com/2022-07/react-folder-structure/)
- [Recommended Folder Structure for React 2025 — DEV.to](https://dev.to/pramod_boda/recommended-folder-structure-for-react-2025-48mc)
- [Delightful React File/Directory Structure — Josh W. Comeau](https://www.joshwcomeau.com/react/file-structure/)
- [How to structure a React App in 2025 (SPA, SSR or Native) — Medium](https://ramonprata.medium.com/how-to-structure-a-react-app-in-2025-spa-ssr-or-native-10d8de7a245a)
- [The Best Folder Structure for Scalable React Apps in 2025 — Medium (Enterprise)](https://medium.com/@tejasvinavale1599/the-best-folder-structure-for-scalable-react-apps-in-2025-enterprise-recommended-4fa755b8f0c7)
- [How to Build a Professional React Project Structure in 2025 — Netguru](https://www.netguru.com/blog/react-project-structure)
- [File Structure FAQ — React Official (legacy)](https://legacy.reactjs.org/docs/faq-structure.html)
- [Guidelines to Improve React App Folder Structure — Max Rozen](https://maxrozen.com/guidelines-improve-react-app-folder-structure)

### Feature-Based Architecture

- [Scalable React Projects with Feature-Based Architecture — DEV.to](https://dev.to/naserrasouli/scalable-react-projects-with-feature-based-architecture-117c)
- [Popular React Folder Structures and Screaming Architecture — Profy.dev](https://profy.dev/article/react-folder-structure)
- [React 19 Clean Architecture Guide (2025) — Medium](https://medium.com/@CodersWorld99/do-not-build-another-react-app-until-you-read-this-clean-architecture-guide-2025-update-e504560c0eff)
- [Production-Grade React Project Structure — DZone](https://dzone.com/articles/production-grade-react-project-structure)
- [Enterprise React Architecture: Scalable Folder Structures — LearnWebCraft](https://learnwebcraft.com/learn/react/structuring-large-react-apps)

### Feature-Sliced Design (FSD)

- [Feature-Sliced Design — official docs](https://feature-sliced.design/)
- [Building Scalable Systems with React Architecture — FSD Blog](https://feature-sliced.design/blog/scalable-react-architecture)
- [The Perfect Folder Structure for Scalable Frontend — FSD Blog](https://feature-sliced.design/blog/frontend-folder-structure)
- [Layered Architecture: Still Relevant for Frontend? — FSD Blog](https://feature-sliced.design/blog/frontend-layered-architecture)
- [Mastering React Hooks: An Architectural Guide — FSD Blog](https://feature-sliced.design/blog/react-hooks-architecture)
- [FSD Architecture in React with TypeScript — Medium (Serhii Koziy)](https://serhiikoziy.medium.com/feature-sliced-design-architecture-in-react-with-typescript-447dc5e6a411)
- [FSD Architecture in React with TypeScript — Medium (Codewithzahid)](https://medium.com/@codewithxohii/feature-sliced-design-architecture-in-react-with-typescript-a-comprehensive-guide-b2652283c6b2)

### Bulletproof-React (Reference Implementation)

- [bulletproof-react — GitHub](https://github.com/alan2207/bulletproof-react)
- [bulletproof-react: project-structure.md](https://github.com/alan2207/bulletproof-react/blob/master/docs/project-structure.md)
- [bulletproof-react: project-standards.md](https://github.com/alan2207/bulletproof-react/blob/master/docs/project-standards.md)

### Component Splitting & Single Responsibility

- [When to Break Up a Component — Kent C. Dodds](https://kentcdodds.com/blog/when-to-break-up-a-component-into-multiple-components) — canonical reference
- [Splitting a UI into Components — Six Pillars — Medium](https://medium.com/@abbas-roholamin/splitting-a-ui-into-components-in-react-six-pillars-of-component-architecture-04538e542ce5)
- [Single Responsibility Principle in React — cekrem.github.io](https://cekrem.github.io/posts/single-responsibility-principle-in-react/)
- [Component Granularity Splitting — Steve Kinney (React Performance)](https://stevekinney.com/courses/react-performance/component-granularity-splitting)
- [SOLID Principles in React — GitHub Gist](https://gist.github.com/Shadid12/79ef5eca781d0158d1a9edfa0ba2fd15)
- [Splitting Components in React — Medium](https://thiraphat-ps-dev.medium.com/splitting-components-in-react-a-path-to-cleaner-and-more-maintainable-code-f0828eca627c)

### Business Logic Separation

- [Path To A Clean React Architecture (Part 6) — Business Logic Separation — Profy.dev](https://profy.dev/article/react-architecture-business-logic-and-dependency-injection)
- [Why Separating Business Logic From Components Matters — Medium](https://asrulkadir.medium.com/why-separating-business-logic-from-components-matters-in-react-applications-5dbe2c71a2ba)
- [Separation of Concerns with React Hooks — Felix Gerschau](https://felixgerschau.com/react-hooks-separation-of-concerns/)
- [Best Practices for Keeping React UI and Logic Separate — DhiWise](https://www.dhiwise.com/post/mastering-the-art-of-separating-ui-and-logic-in-react)
- [React Best Practices: Separation of Concerns — Cheesecake Labs](https://cheesecakelabs.com/blog/react-best-practices-in-projects/)

### Constants, Utils, Helpers

- [How to Organize Constants in a Dedicated Layer — Semaphore CI](https://semaphore.io/blog/constants-layer-javascript)
- [How to Add a Constants File to Your React Project — Medium](https://medium.com/@austinpaley32/how-to-add-a-constants-file-to-your-react-project-6ce31c015774)
- [Tips to Use Constants File in TypeScript — DEV.to](https://dev.to/amirfakour/tips-to-use-constants-file-in-typescript-27je)
- [Structuring React Components: Best Practices — Nile Bits](https://www.nilebits.com/blog/2024/04/structuring-react-components/)

### Design Patterns

- [21 Fantastic React Design Patterns — Persson Dennis](https://www.perssondennis.com/articles/21-fantastic-react-design-patterns-and-when-to-use-them)
- [React Design Patterns — Refine.dev](https://refine.dev/blog/react-design-patterns/)
- [React Design Patterns and Best Practices for 2025 — Telerik](https://www.telerik.com/blogs/react-design-patterns-best-practices)
- [React Architecture Pattern and Best Practices — GeeksforGeeks](https://www.geeksforgeeks.org/reactjs/react-architecture-pattern-and-best-practices/)
