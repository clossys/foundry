---
slot: "context.market.trend"
source: {"kind":"derived","ref":["finding:foundry-public-repo-facts","finding:foundry-owner-answers-2026-11-03"]}
feeds: []
functions: ["product","tech"]
note: "Unpinned initial-fill draft for the public Foundry Studio, derived from the public repository, Studio checklist findings and owner answers of 2026-11-03; not approved and not evidence of shipped behavior."
---

## Direction
- Shift: coding agents now edit repositories through a terminal and a CLI, so design, copy and pages can be produced by agents rather than by hand in a separate tool.
- Effect: the hand-made alternative (a design file, a copy document and a hand-built page) becomes the slow step; agents need sourced direction and checked records to work from instead.
- Timing: now (planner default, open to owner change).

## Because
- Foundry is operated through the `clossys` CLI verbs and agent skills, which assumes a coding agent does the work (finding:foundry-public-repo-facts)
- Timing is a planner default recorded with the owner answers (finding:foundry-owner-answers-2026-11-03)

## Watch
- If findings that date coding-agent adoption = 0 by 2026-12-31, then keep Timing as a planner default and do not cite it downstream as measured fact.
