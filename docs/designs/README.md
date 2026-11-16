# RyanAI design records

Create one directory per workstream. Keep the artefacts distinct so reviewers can tell what was proposed, what was challenged, and what the owner approved.

Recommended files:

- `concepts_brief.md` — requirements and direction agreed during brainstorming.
- `design_draft.md` — complete draft specification.
- `review_findings.md` — independent Goldfish findings, source references, and dispositions.
- `approved_specification.md` — final owner-approved design used to guide implementation.
- `drift_report.md` — optional EGM comparison of approved documentation against current source.

Start from [TEMPLATE.md](./TEMPLATE.md). Follow [the RyanAI EGM design-assurance policy](../engineering/EGM_DESIGN_ASSURANCE.md).

A reviewer must not claim that EGM review ran unless the coding agent executed fresh reviewer contexts. If the chosen agent cannot create fresh subagents, record the review as blocked and obtain an alternative independent human review. CI checks code; it does not infer that a design review happened.
