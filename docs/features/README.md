# docs/features/

Human-readable, cross-cutting / feature-level documentation about DevDigest —
prose docs a person reads to understand what a feature does and how it fits
together, not specs to implement from and not living engineering notes.

Docs here are primarily produced by the `doc-writer` agent
(`.claude/agents/doc-writer.md`), which reads code, a Development Plan, or
other supplied material and writes prose (with diagrams, via the
`mermaid-diagram` skill) into this folder. You can also add or edit files here
by hand — the agent is the primary producer, not the only permitted one.

## What belongs here

- Explanations of already-implemented functionality: what a feature does, how
  its pieces fit together, why it was built that way.
- Feature-level docs converted from a Development Plan (`<module>/specs/*.md`)
  into readable prose, for people who want the "what and why" without reading
  the plan's step-by-step implementation contract.
- Docs synthesized from other supplied material (design notes, transcripts,
  slides) when someone wants a durable written version.

## What does NOT belong here

`docs/features/` is one of four places documentation-shaped content can live
in this repo. Don't confuse them:

| Content | Lives in | Not here because |
|---|---|---|
| Pre-implementation plans, step breakdowns, file lists, test criteria | `<module>/specs/*.md` (e.g. `specs/`, `server/specs/`) | Those are inputs to implementation, not docs about a finished feature. `doc-writer` may *read* a spec to generate a doc from it, but the spec itself stays in `specs/`. |
| Non-obvious things an engineer had to learn while working in a module | `<module>/insights.md` | Living, engineer-facing knowledge maintained via the `engineering-insights` skill — not user-facing documentation, and not something `doc-writer` should write to. |
| Non-default conventions, gotchas, "map of the module" | `<module>/AGENTS.md` (and root `AGENTS.md`) | Same reasoning as `insights.md`: engineer-facing map/conventions, kept short and session-loaded, not prose docs. |
| DevDigest's own DB-stored product review-agent prompts (`general-reviewer`, `security-reviewer`, `performance-reviewer`) and the conventions for writing them | `docs/agent-prompts/` | A narrow, purpose-built folder for one specific artifact type (agent system prompts versioned into the DB), not a general docs home. |
| Deep per-package design notes | `<pkg>/docs/` (e.g. `server/docs/`, `client/docs/`) | Distinct, currently-empty slots scoped to a single package. `doc-writer` targets root `docs/features/` by default and only writes to a per-package slot on explicit request. |

## Source / staleness header convention

Every doc in this folder should start with a line stating what produced it,
because the two generation modes carry different staleness risk — a doc
generated from a plan can describe something that was never built, or built
differently from what the plan said. Use one of:

```
Generated from: implemented code as of <date or commit>
Generated from: specs/<slug>.md (plan — may not reflect final implementation)
Generated from: <other supplied material>, <date>
```

A reader should never have to guess whether a doc reflects what was actually
built or only what was intended.

## Known pre-existing exception

[`cost-in-pr-list.md`](./cost-in-pr-list.md) already lived in this folder
before this README and the source-header convention existed. It is
spec/plan-shaped (`Status: proposed`, an implementation checklist) rather than
prose documentation of a shipped feature, and it predates the conventions
above. It is left as-is deliberately — do not move, delete, or rewrite it as
part of adopting this convention. Treat it as a known exception, not as a
template for new docs: new files added here should follow the prose +
source-header convention described above, not that file's shape.
