---
slot: "context.market.trend"
source: {"kind":"derived","ref":["finding:foundry-public-repo-facts","finding:foundry-public-studio-readonly-bound"]}
feeds: []
functions: ["product","tech"]
note: "Unpinned initial-fill draft for the public Foundry Studio, derived from the public repository and Studio checklist findings; not approved and not evidence of shipped behavior."
---

## Direction
- Shift: coding agents now edit repositories through a terminal and a CLI, so design, copy and pages can be produced by agents rather than by hand in a separate tool.
- Effect: the hand-made alternative (a design file, a copy document and a hand-built page) becomes the slow step; agents need sourced direction and checked records to work from instead.
- Timing: NEED: no dated adoption figure is recorded; this draft names the shift without claiming when it peaks.

## Because
- Foundry is operated through the `clossys` CLI verbs and agent skills, which assumes a coding agent does the work (finding:foundry-public-repo-facts)
- Studio is read-only and every change goes through the owning agent, which only works if agents author the records (finding:foundry-public-studio-readonly-bound)

## Watch
- If findings that date coding-agent adoption = 0 by 2026-12-31, then keep Timing as NEED and do not cite this trend as fact downstream.
