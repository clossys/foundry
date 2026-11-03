---
slot: "execution.priority.parked"
source: {"kind":"derived","ref":["finding:foundry-public-studio-readonly-bound","finding:foundry-public-studio-exclusions","finding:foundry-public-studio-delivery"]}
feeds: []
functions: ["product"]
note: "Unpinned initial-fill draft for the public Foundry Studio, derived from the public repository and Studio checklist findings; not approved and not evidence of shipped behavior."
---

## Direction
- Parked: in-Studio editing, hosted deployment and paid offers.
- Why: Studio is read-only by requirement, and fill comes before any surface that would change records outside the agents.
- Revisit: when every slot holds a candidate and the owner has pinned the Director slots.

## Because
- Studio has no forms, saves or write endpoints (finding:foundry-public-studio-readonly-bound, finding:foundry-public-studio-exclusions)
- The current bet is initial fill (finding:foundry-public-studio-delivery)

## Watch
- If requests to unpark an item > 3 in any month, then raise them at the next owner review.
