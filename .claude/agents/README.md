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
