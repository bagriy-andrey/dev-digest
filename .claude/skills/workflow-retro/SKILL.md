---
name: workflow-retro
description: "Runs a retrospective over a just-completed multi-agent/subagent workflow (a spec-creator clarification chain, sdd-build's implementer→verify→fix-loop, /code-review ultra, a batch of forked agents, etc.) — reports the agent roster and launch order, per-agent token/tool-call/duration stats, clarification-round friction, duplicated work, gaps, and concrete recommendations. Appends a dated entry to .claude/workflow-retros.md. Run manually with /workflow-retro right after the workflow finishes, while its transcript is still in context."
allowed-tools: Read, Edit, Write, Grep, Glob
user-invocable: true
---

# Workflow Retro

A retrospective pass over the multi-agent orchestration that just happened in
*this* conversation — not over the feature it produced. `engineering-insights`
captures what was learned about the **code**; this skill captures how well
the **agents and the human-in-the-loop process** performed while producing
it. Both can fire in the same session; they write to different files and
never overlap in content.

## When to run
Manually, right after a multi-agent workflow completes, while the transcript
is still in context — this skill reads the current conversation, it does not
reconstruct history from disk. Good triggers: a `spec-creator` run finished
(with or without clarification rounds), an `sdd-build` pass completed, a
`/code-review ultra` came back, a batch of parallel forks all reported in.

**Deliberately not wired to a `Stop` hook.** `engineering-insights` already
owns the automatic Stop-hook slot, and it fires on every idle turn while a
background agent is pending — this session's own transcript is a live
example of that noise (the same "still waiting" message repeated many times
while `spec-creator` ran). Stacking a second automatic hook on top would
double it. Run this one on purpose, once, when there's an actual workflow to
grade.

## What it collects — from the current conversation only
This skill does not shell out, hit a cost API, or read other sessions' JSONL
transcripts. Everything below comes from what's already in context.

1. **Agent roster & order** — every `Agent` tool call this session, in
   chronological order: `subagent_type`, one-line purpose (its `description`),
   and every `SendMessage` resume of an already-spawned agent (a resume is a
   beat in the timeline, not a new agent — note it as "→ resumed with X").
2. **Per-agent cost/effort** — for each completed subagent, pull
   `subagent_tokens`, `tool_uses`, and `duration_ms` from its
   `<usage>` block in the task-notification. Sum for a workflow total.
   Look up that agent's `model:` frontmatter in `.claude/agents/<name>.md`
   (or `general-purpose`/built-in default if it's not a custom agent) and
   attach a rough **≈$ estimate** using known per-model per-token pricing —
   label it clearly as an order-of-magnitude estimate, since the usage block
   gives a total, not an input/output split. State plainly what this total
   does **not** include: the orchestrating (main) thread's own token spend
   (system prompt, tool results, user turns) is not introspectable by this
   skill — point the user at the CLI's own `/cost` for the true end-to-end
   number rather than implying this total is it.
3. **Clarification friction** — count every user round-trip: `AskUserQuestion`
   calls made directly by the orchestrator, plus every stop-and-ask a
   dispatched agent returned (visible as a relayed question that got a
   `SendMessage` resume). Name which agent/step asked, and how many rounds.
   A high count is itself a finding, not just a log line — flag whether each
   round was genuinely blocking or whether a stated default could have
   avoided it.
4. **Duplicated / redundant work** — repeated identical tool calls, repeated
   identical questions, information handed to one agent that a previous step
   already produced and could have been forwarded instead of re-derived,
   hook/system noise that repeated without adding information.
5. **What went smoothly** — steps that produced a correct, complete result
   first-pass with zero back-and-forth. Worth naming so it's reinforced, not
   just the failures.
6. **Gaps / missed** — anything a dispatched agent plausibly should have
   caught, verified, or asked about but didn't; a silent assumption; a check
   it skipped.
7. **Recommendations** — concrete and actionable: a prompt tightening for a
   specific `.claude/agents/*.md` or `.claude/skills/*/SKILL.md` file, a
   default worth hardcoding to kill a recurring clarification round, a step
   that could run in parallel instead of serially, context that should be
   handed forward explicitly next time instead of re-derived.

## Status flag
Classify the run in one line, using clarification-round count as the primary
signal (tune by feel, not a rigid formula): **clean** (0–1 rounds, no
rework), **noisy** (2+ rounds and/or duplicated work, but it landed), or
**blocked** (a step stalled on missing info or had to be redone). This is
what makes entries scannable without reading full prose later.

## Trend vs. previous run
Before writing the new entry, `Grep` `.claude/workflow-retros.md` for prior
entries with the same workflow/feature name or the same lead agent. If found,
add one line comparing the headline numbers (tokens, clarification rounds,
status flag) to the most recent prior entry — this is what turns a single
retro into a trend instead of a one-off.

## Output
Print the summary to chat (the user is waiting on it right after the
workflow), **and** append one dated entry to `.claude/workflow-retros.md`
(create it with the structure below if it doesn't exist yet). Append-only —
never edit or delete a prior entry, mirroring `engineering-insights`'s rule.
Never modify any other file.

```
## <YYYY-MM-DD> — <workflow / feature name>

**Status:** clean | noisy | blocked
**Agents launched (in order):** <subagent_type — purpose> → <subagent_type — purpose> → …
**Token/effort totals (subagents only):**

| Agent | Model | Tokens | ≈$ | Tool calls | Duration |
|---|---|---|---|---|---|
| ... | ... | ... | ... | ... | ... |

*Excludes main-thread token spend — check `/cost` for the true session total.*

**Clarification rounds:** <N> — <who asked, how many each, blocking vs. avoidable-with-a-default>
**Duplicated / redundant:** <bullets, or "none observed">
**Went smoothly:** <bullets>
**Gaps / missed:** <bullets, or "none observed">
**Vs. previous run of this workflow:** <delta, or "first recorded run">

**Recommendations:**
- <bullet, ideally naming a specific file to edit>
```
