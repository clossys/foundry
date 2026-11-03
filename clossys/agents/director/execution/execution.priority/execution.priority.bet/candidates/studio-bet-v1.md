---
slot: "execution.priority.bet"
source: {"kind":"derived","ref":["finding:foundry-public-studio-delivery","finding:foundry-public-studio-mission"]}
feeds: []
functions: ["product"]
note: "Unpinned initial-fill draft for the public Foundry Studio, derived from the public repository and Studio checklist findings; not approved and not evidence of shipped behavior."
---

## Direction
- Bet: initial fill: every slot of every agent holds a candidate drawn from cleared upstream input before anyone iterates.
- Outcome: a user opens Studio and sees a candidate in every slot rather than an empty template.
- Kill: if filled candidates are mostly NEED placeholders after the owner review, stop and gather evidence first rather than filling further.

## Because
- F9 calls for one candidate per empty slot from cleared upstream input (finding:foundry-public-studio-delivery, finding:foundry-public-studio-mission)

## Watch
- If candidates whose keys are all NEED rises above 20% of Director slots at any owner review, then pause downstream fill and gather findings.
