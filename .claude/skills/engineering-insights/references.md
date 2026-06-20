# Engineering Insights — references & rationale

Sources consulted while designing this skill, each with the one thing taken from it. The skill
is a "manual RAG without infrastructure": a structured file the previous session leaves for the
next to read. Research on long-context models shows they apply structured context far better than
they reconstruct knowledge from scratch — which is why a plain markdown file works without vectors.

## Capture-learnings loop (primary)
- **MindStudio — Self-Learning AI Skill System (LEARNINGS.md + wrap-up)** — the 7 fixed sections
  (What Works · What Doesn't Work · Codebase Patterns · Tool & Library Notes · Recurring Errors &
  Fixes · Session Notes · Open Questions) and the vague-vs-useful bar. *self-learning-ai-skill-system-learnings-md-wrap-up*
- **MindStudio — How to Build a Learnings Loop** — the Session Protocol for `CLAUDE.md` (read at
  start + summarize; append, don't overwrite at end) and "forced active reading" (confirm + summarize
  top-3) as a sanity check that the file was actually read. *how-to-build-learnings-loop-claude-code-skills*
- **MindStudio — Self-Evolving Memory with Obsidian + Hooks** — the 4 capture categories
  (Patterns / Mistakes / Decisions / Context); our 7 sections subsume them (Decisions → Codebase
  Patterns). Stop-hook flow: read transcript → Claude extracts structured JSON → write markdown. *self-evolving-claude-code-memory-obsidian-hooks*
- **MindStudio — Self-Learning Skill (why no RAG)** — entry structure = date + observation +
  concrete action; "vague entries waste context and don't change behavior." *self-learning-claude-code-skill-learnings-md*
- **MindStudio — Auto-Memory (what to store)** — the capture/don't-capture list in `examples.md`
  (store build/test commands, conventions, env quirks + exact flags, error+fix, architectural notes;
  skip one-time edits and anything already clear in code). *what-is-claude-code-auto-memory*
- **MindStudio — Compounding Knowledge Loop** — the Stop-hook idea (a `Stop` hook in
  `.claude/settings.json` fires at session end with the transcript/tools/files on stdin). Capture
  only: tradeoff decisions, non-obvious fixes, new conventions, file context. *compounding-knowledge-loop-claude-code*

## Automatic mode (implemented — `.claude/settings.json` + `.claude/hooks/inject-insights.sh`)
The capture loop runs without `/engineering-insights`:
- **Read** = a `UserPromptSubmit` *command* hook (`inject-insights.sh`): deterministically detects
  the prompt's module(s) and injects their `insights.md` (only when non-empty). Chosen over a
  prompt hook because detection is a cheap, reliable grep — no LLM round-trip per prompt.
- **Write** = a `Stop` *prompt* hook that drives this skill's wrap-up in-session. Chosen over the
  MindStudio external-script-calls-the-API approach because it needs **no extra API key** and
  reuses the live agent (which already has the session context and the skill loaded). It also
  terminates cleanly: nothing-substantive → approve; post-capture re-fire → approve.
- Anthropic ("how we use skills") confirms skills can pair with hooks for always-on behavior;
  hooks (system-run) give the reliability a description-triggered skill (Claude-run) can't.

## Self-improving CLAUDE.md
- **dev.to / Aviad Rozenhek** — meta-rules for entries: lead with *why*, be concrete (real
  commands), bullets over paragraphs, one point per block. Reflection prompt: "Abstract and
  generalize the learning, then write it down."
- **dev.to / evoleinik** — one-line entry style ("Prisma Accelerate has 5MB response limit — use
  select not include"); end-of-session "only add if genuinely useful"; monthly prune of fixed bugs
  and duplicates; a hard item ceiling to prevent bloat. Boundaries: not a docs replacement, not a
  crutch for bad tooling.

## Anthropic (official)
- **Skill authoring best-practices** — concise SKILL.md (<500 lines); progressive disclosure (link
  `examples.md` / `references.md` one level deep); `description` = what + when, third person; gerund
  naming (we keep the user-chosen noun phrase `engineering-insights`, an accepted alternative);
  provide one default, not a menu; consistent terminology.
- **Lessons from building Claude Code: how we use skills** — skills are folders (scripts/assets), not
  just markdown; skills can register *dynamic hooks* that live only while the skill is active
  (`/careful` blocks `rm -rf`/`DROP TABLE`/force-push; `/freeze` blocks edits outside a dir). This is
  the L06 path to automatic, unskippable capture.

## Example skills studied
- **glebis/claude-skills — `retrospective`** — the wrap-up discipline we borrowed: gate on session
  depth; collect signals (skill invocations, user corrections, repeated patterns, workflows); read
  existing memory/skill files and **dedup**; generate ≤5 candidates **ranked by signal** (user
  corrections highest); single multi-select approval, then silent write; reads target files first to
  check conflicts; *never writes learnings about itself*.
- **mcpmarket — Lessons Learned (Retrospectives)** & **CLAUDE.md Lessons Manager** — (pages returned
  HTTP 429; summarized from the research digest) enforce quality / prevent generic platitudes; extract
  from chat history + terminal output; duplicate-detection and rule-consolidation to stay lean.

## Tangential (context engineering)
- **MindStudio — Scripts vs Markdown** — executable scripts cut tokens up to ~90% and are more
  reliable; use scripts for deterministic checks, prose for judgment. Supports moving the L06
  capture into a script.
- **MindStudio — Skills vs Hooks** — "hooks aren't called by Claude — the system calls them." Skill =
  Claude's judgment (L01 manual); hook = deterministic lifecycle guarantee (L06 Stop).
- **MindStudio — Context Compounding** — `CLAUDE.md` is a fixed-size system input that doesn't grow
  with history; shorter focused sessions keep peak context small. Capture before `/clear`.

## Deliberate divergences (intentional, not oversights)
- *self-learning-claude-code-skill* says you **MUST** update the file every session "even if nothing
  new". We **reject** this in favor of the user's rule: **write nothing if nothing substantive** —
  signal-to-noise beats volume, and a file padded with empty updates gets ignored.
- The slides say write to `LEARNINGS.md`; this repo already wires `insights.md` per module, so we
  reuse `insights.md` (matches the skill name) instead of introducing a parallel file.
