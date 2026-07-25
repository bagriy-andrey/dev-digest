---
name: sdd-build
description: "Builds an already-approved Implementation Plan end-to-end: implementer(s) → plan-verifier + architecture-reviewer → bounded architecture fix-loop → plan-verifier (final). Does NOT run spec-creator or implementation-planner — those run manually, separately, before this. Run manually with /sdd-build <plan-file-path>."
allowed-tools: Read, Write, Edit, Bash, Grep, Glob, Agent
user-invocable: true
---

# SDD Build

Takes an already-written, already-approved Implementation Plan
(`<module>/specs/<feature-slug>.md`, produced by the `implementation-planner`
agent in a separate, prior session) and builds it: dispatches `implementer`
per step, merges the work back, runs verification, and fixes architecture
findings in a bounded loop. It does not create a spec and does not plan — run
`spec-creator` and `implementation-planner` yourself, manually, before
invoking this.

`test-writer` is intentionally **disabled** in this pipeline right now (cost
control — Opus/Sonnet spend on an extra full agent pass per run). Re-enable
it by re-adding a step that dispatches `test-writer` targeted at
`plan-verifier`'s coverage gaps (see the previous `sdd-run` design if you need
the exact wording) if the team decides the coverage trade-off isn't worth it
anymore.

---

## Step 0 — Input

The invocation (`/sdd-build <path>`) must be a path to an existing
`<module>/specs/<feature-slug>.md` Implementation Plan. If no path is given,
or the file doesn't exist, stop and ask for one — do not guess which plan to
build, and do not fall back to writing a spec or a plan yourself.

Read the plan fully before doing anything else: `Execution mode`
(multi-agent/single-agent), `## 3. Execution order` (steps, file lists,
dependencies), `## 4. Definition of Done`.

---

## Step 1 — Prepare an integration branch

```bash
git status
git branch --show-current
```

- Already on a dedicated feature branch (not `main`): use it as the
  integration branch.
- On `main`: create one first — `git checkout -b <feature-slug>` — never
  build multi-step feature work directly on `main`.

---

## Step 2 — Implementation stage

Group the plan's steps into **dependency tiers** from `## 3. Execution
order`: tier 0 = steps with no unmet dependency, tier 1 = steps whose only
dependencies are in tier 0, and so on.

For each tier, in order:

1. Dispatch one `implementer` (`subagent_type: "implementer"`) per step in
   the tier — each call gets the plan file path, the step number, and its
   declared file list. If `Execution mode: multi-agent` and the tier has 2+
   steps, dispatch them **as parallel `Agent` calls in a single message**. If
   `Execution mode: single-agent`, dispatch one at a time, sequentially, even
   within the same tier.
2. Each `implementer` runs in its own isolated git worktree and reports back
   a worktree path + branch, files touched, test results, typecheck status.
3. **Merge every branch from this tier into the integration branch before
   starting the next tier** — the next tier's `implementer` starts its
   worktree fresh from the integration branch, so it must already contain
   earlier tiers' work:
   ```bash
   git merge --no-ff <implementer-branch> -m "Integrate step N: <short desc>"
   ```
   Steps in one tier have disjoint file lists (the plan's non-negotiable
   constraint) — these merges should never conflict. If one does, stop and
   report it; that means the plan's file ownership was wrong, not something
   to silently resolve.
4. If an `implementer` reports it had to stop because the step required a
   file outside its declared list, stop the whole run and report it — a
   plan-boundary problem, not something to route around.
5. Leave merged worktrees/branches in place (cheap, reversible) — mention
   their paths in the final report.

---

## Step 3 — Verification: plan-verifier (pass 1) + architecture-reviewer

Once every tier is merged, dispatch **in parallel, in one message**:
- `plan-verifier` (`subagent_type: "plan-verifier"`), plan file + diff range
  (`main...HEAD`, or the integration branch's actual base).
- `architecture-reviewer` (`subagent_type: "architecture-reviewer"`), same
  diff range.

---

## Step 4 — Architecture fix-loop (bounded, autonomous)

If `architecture-reviewer` returns `PASS`, skip to Step 5.

If `BLOCKED` (CRITICAL findings), loop up to **3 iterations**:

1. Fix each `CRITICAL` finding directly, yourself, in the integration
   branch's working tree — apply the same skill routing `implementer` uses
   (`onion-architecture` for `server/`/`reviewer-core/` layering,
   `ui-architecture` for `client/` placement). Leave `WARNING`/`INFO` for the
   user to triage later.
2. Re-run `pnpm typecheck` in every package you touched.
3. Re-dispatch `architecture-reviewer` on the same scope.
4. `PASS` → exit the loop, continue to Step 5.
5. Still `BLOCKED` after 3 iterations → **stop the pipeline**. Report which
   findings remain, what you tried, and ask the user how to proceed. Do not
   attempt a 4th iteration or downgrade severity to force a pass.

---

## Step 5 — plan-verifier (pass 2, final)

Re-dispatch `plan-verifier` on the plan file and the now-updated diff range.
This is the final confirmation gate.

If pass 2 still shows gaps, report them plainly — a single final pass is
enough; route any remaining gap to whichever agent's job it actually is
(another `implementer` pass for missed steps, a manual `test-writer` run for
coverage — since it's disabled here, see the note at the top).

---

## Step 6 — Final report

Summarize: integration branch name and what got merged tier by tier,
architecture verdict (+ fix-loop iteration count if any), final
`plan-verifier` coverage table. Explicit reminder: this pipeline does not run
`test-writer` (disabled) or `pr-self-review` (separate, user-run gate before
opening a PR) — tell the user to run `/pr-self-review` next, and to consider
a manual `test-writer` pass if `plan-verifier` flagged untested requirements.
