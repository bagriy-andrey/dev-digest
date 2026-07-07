# Agents

Custom subagents for this project. Canonical location is `.claude/agents/` —
each is a single Markdown file: YAML frontmatter (`name`, `description`,
`tools`, and other Claude Code subagent fields) followed by the agent's
system prompt. Checked into version control so the whole team gets the same
agents.

## Catalog

| Agent | Description | Tools |
|-------|--------------|-------|
| [researcher](researcher.md) | Read-only research agent — investigates the codebase, the web, or both, and reports back cited findings. Never modifies anything. | `Read, Grep, Glob, WebSearch, WebFetch` |
| [planner](planner.md) | Produces a structured Development Plan (file-by-file breakdown, execution order, definition of done) for a feature request, respecting this repo's package boundaries. Writes only the plan document. | `Read, Grep, Glob, Bash, Write` |
| [implementer](implementer.md) | Implements ONE execution step of a Planner-produced plan — backend or frontend, whichever the step touches. Meant to be launched multiple times in parallel, one instance per non-overlapping step. | `Read, Write, Edit, Bash, Grep, Glob` |
| [test-writer](test-writer.md) | Writes tests for existing DevDigest code — both client/ (React/Next.js, vitest + jsdom) and server/ (Fastify, vitest + testcontainers). Use when code has been written and needs tests, not when new features need designing or implementing. Runs the tests it writes and confirms they pass. Operates in the current working tree so it can see just-implemented, uncommitted code. | `Read, Write, Edit, Bash, Grep, Glob` |
| [architecture-reviewer](architecture-reviewer.md) | Read-only architecture reviewer for DevDigest. Checks onion-architecture layering (server/reviewer-core), UI architecture placement (client/), and cross-package boundary integrity (vendored @devdigest/shared / @devdigest/ui drift, package-boundary violations). Emits CRITICAL/WARNING/INFO findings and a BLOCKED/PASS verdict. Never modifies files. Use for an architecture pass, not a full pre-PR gate (that's the pr-self-review skill) and not requirement-coverage checking (that's plan-verifier). | `Read, Grep, Glob, Bash` (`disallowedTools: Write, Edit`) |
| [plan-verifier](plan-verifier.md) | Verifies a Development Plan (a specs/*.md file) was actually implemented — requirement coverage and traceability, not code quality or architecture (use architecture-reviewer for that). Cross-checks each plan step, test criterion, and Definition-of-Done item against the real git diff and by actually running the plan's declared test commands. Read-only: returns a per-requirement checklist directly, writes no report file. | `Read, Grep, Glob, Bash` (`disallowedTools: Write, Edit`) |
| [doc-writer](doc-writer.md) | Writes human-readable documentation for DevDigest. Three modes: (1) document already-implemented functionality by reading the code, (2) turn a Development Plan (specs/*.md) into prose docs, (3) turn arbitrary supplied material into docs with diagrams. Writes to docs/features/ (see docs/features/README.md for the convention). Every doc it produces states which mode/source it came from. Use for documentation, not for planning or implementing. | `Read, Grep, Glob, Bash, Write` |

## Agents vs Skills

An **agent** is a subagent with its own context window, invoked via the Agent
tool for a self-contained job (research, planning, implementing). A **skill**
is reference/procedural knowledge loaded into whichever agent is already
running (see `.claude/skills/README.md`). Agents use skills, not the other
way around — e.g. `planner` and `implementer` both apply `onion-architecture`,
`ui-architecture`, and the rest of the skill catalog depending on what
they're working on.

## Planner + Implementer — design basis and sources

These two were designed together as a **plan-then-execute pair**: `planner`
produces a spec that `implementer` can execute with zero shared context (a
fresh subagent invocation carries no memory of the planning conversation), so
the plan document itself has to be the entire handoff contract. The design
pulled from a bounded research pass (`researcher` agent, 2026-07-03) across
official Claude Code docs and third-party multi-agent-coding writeups; the
concrete decisions and their sources:

| Decision in `planner.md` / `implementer.md` | Based on | Source |
|---|---|---|
| Subagent file = YAML frontmatter + Markdown prompt; `tools`, `skills`, `isolation`, `memory`, `model` fields | Official subagent spec | [Create custom subagents — Claude Code Docs](https://code.claude.com/docs/en/sub-agents) |
| `skills:` frontmatter preloads `onion-architecture` / `ui-architecture` into `planner` at startup, instead of relying on it to discover them | "Preload skills into subagents" | [Create custom subagents — Claude Code Docs](https://code.claude.com/docs/en/sub-agents) |
| `isolation: worktree` on `implementer`, so parallel instances each get their own git worktree | "Supported frontmatter fields" | [Create custom subagents — Claude Code Docs](https://code.claude.com/docs/en/sub-agents) |
| A skill's `description` is the literal routing signal Claude pattern-matches on — informs how `planner`/`implementer` are told to invoke skills by file pattern rather than by vague topic | "Configure skills" | [Extend Claude with skills — Claude Code Docs](https://code.claude.com/docs/en/skills) |
| Plan must be fully self-contained (explicit file paths, per-step dependencies, definition of done) because a non-`fork` subagent starts with **zero shared context** | "What loads at startup" | [Create custom subagents — Claude Code Docs](https://code.claude.com/docs/en/sub-agents) |
| Plan document's 7-part shape (Summary / Files to Modify / New Files / Dependency Changes / Execution Order / Test Criteria / Risks) — adapted into `planner.md`'s "Plan document structure" | "Separation of Planning and Execution" (plan-as-reviewable-contract pattern) | [dev.to — Varun Pratap Bhardwaj](https://dev.to/varun_pratapbhardwaj_b13/separation-of-planning-and-execution-the-key-pattern-for-reliable-ai-coding-agents-5b53) |
| Spec → Plan → Tasks → Implement pipeline, `constitution.md`-style ground rules (our analog: `onion-architecture` as the always-preloaded constraint) | GitHub `spec-kit` | [github/spec-kit](https://github.com/github/spec-kit), [spec-driven.md](https://github.com/github/spec-kit/blob/main/spec-driven.md) |
| "Plan-then-execute" as the named architecture: full plan up front, distinct executor carries it out step by step | Plan-and-execute agent pattern | [LangChain — Planning Agents](https://www.langchain.com/blog/planning-agents), [agentic-patterns.com](https://www.agentic-patterns.com/patterns/plan-then-execute-pattern/) |
| Non-overlapping file lists per execution step as the actual parallel-safety mechanism (worktree isolation alone isn't enough — see the root `insights.md` entry this produced) | Native `Agent Teams` file-locking/ownership model | [Orchestrate teams of Claude Code sessions](https://code.claude.com/docs/en/agent-teams) |
| Same principle confirmed outside Claude Code: partition by file-touch list before parallelizing, not just by domain | Independent multi-agent-coding writeups | [MindStudio — Git Worktrees for AI Coding](https://www.mindstudio.ai/blog/git-worktrees-parallel-ai-coding-agents), [Augment Code — Multi-Agent Guide](https://www.augmentcode.com/guides/multi-agent-ai-system-code-development) |

Decisions that came from **this repo's own conventions**, not the web
research:

- The skill-routing table in both agents (which skills apply to `client/**`
  vs `server/**` vs `reviewer-core/**`) reuses the bucket classification
  already established by the `pr-self-review` skill — same buckets, same
  skill assignments, not reinvented.
- Where the plan document lives (`<module>/specs/<feature-slug>.md`) matches
  the existing hand-written example at `server/specs/skills.md`, which
  already covers a cross-cutting server+client feature from one file owned
  by `server/`.
- `implementer`'s Definition-of-Done is narrower than a full review gate
  (typecheck + relevant tests only) — `pr-self-review` remains a separate,
  user-run gate before opening a PR, not something `implementer` invokes
  itself.

## Test Writer / Architecture Reviewer / Plan Verifier / Doc Writer — design basis and sources

These four fill gaps the original three agents didn't cover: writing tests
for already-implemented code, judging architecture without write access,
checking that a plan's requirements were actually satisfied, and producing
human-readable docs. The design came from a bounded research pass (4 parallel
`researcher` runs, project + web scope, 2026-07-03); the concrete decisions
and their basis:

- **Test Writer runs in the current working tree, with no `isolation:
  worktree`** — unlike `implementer`, it needs to see uncommitted,
  just-implemented code in the session's own working copy, not a stale
  worktree snapshot forked at an earlier commit.
- **Test Writer routes server tests to `TESTING.md` + existing example files**
  (`server/test/adapters.test.ts`, `server/test/integration.it.test.ts`), not
  to a skill — no server-testing skill exists, and it explicitly distrusts
  `fastify-best-practices/rules/testing.md`'s `node:test` + `app.inject()`
  samples, since this repo's actual runner is vitest (see the root
  `insights.md` entry this produced).
- **Test Writer's anti-AI-test-failure-mode block** (no over-mocking, no
  tautological/meaningless assertions, break the "cycle of self-deception")
  is sourced from convergent 2025–2026 findings on LLM-generated test quality.
- **Architecture Reviewer and Plan Verifier are read-only**, carrying both an
  omitted `Write`/`Edit` from `tools` and an explicit `disallowedTools: Write,
  Edit` as defense-in-depth — this follows Anthropic's official "Code
  reviewer" subagent example pattern rather than relying on tool omission
  alone.
- **Architecture Reviewer reuses `pr-self-review`'s `CRITICAL/WARNING/INFO` +
  `BLOCKED/PASS` vocabulary**, not the DevDigest product review agents'
  JSON-schema `CRITICAL/WARNING/SUGGESTION` + `request_changes/comment/approve`
  vocabulary — it's a Claude-Code Markdown-output consumer like
  `pr-self-review`, not one of the DB-stored product agents in
  `docs/agent-prompts/`.
- **Architecture Reviewer covers the cross-package-boundary gap** no existing
  skill covers on its own: it reads the root and package `AGENTS.md` files and
  checks for vendored-copy drift (`@devdigest/shared`, `@devdigest/ui`) and
  package-boundary violations, on top of the `onion-architecture`/
  `ui-architecture` skills it preloads.
- **Plan Verifier is scope-fenced to coverage/traceability only** — explicitly
  not architecture or code-quality review (that's Architecture Reviewer's job,
  or `pr-self-review`'s). It handles both plan-document shapes seen in this
  repo (the newer 6-section `specs/*.md` template and the older
  `server/specs/skills.md` style), verifies against the real `git diff` and by
  actually running the plan's declared test commands rather than trusting
  self-reported completion, and follows `researcher`'s no-report-file
  convention — it returns its checklist directly instead of writing a file.
- **Doc Writer formalizes `docs/features/`** (plus its own new README) as the
  documentation target. Structurally it's closest to `planner` (`Write`
  access, no `isolation`) rather than to the read-only reviewers, since
  producing a doc is itself the deliverable. It preloads `mermaid-diagram` for
  diagram generation, and every doc it writes carries a source/staleness
  header stating which of its three modes (implemented-code / plan-to-docs /
  arbitrary-material) produced it.
