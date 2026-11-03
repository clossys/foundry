---
slot: "capability.team.structure"
source: {"kind":"derived","ref":["finding:foundry-public-studio-behavior","finding:foundry-public-studio-delivery","finding:foundry-public-studio-mission"]}
feeds: []
functions: ["people","ops"]
note: "Unpinned initial-fill draft for the public Foundry Studio, derived from the public repository and Studio checklist findings; not approved and not evidence of shipped behavior."
---

## Direction
- Shape: one owner over four agents with separate jobs and no overlap.
- Decides: the owner approves pins; each agent decides only inside its own slots; Publisher assembles but never writes or designs.
- Rhythm: initial fill, then an owner review of candidates, then iteration through the owning agent.

## Because
- Publisher assembles only, Designer owns visuals and Writer owns copy (finding:foundry-public-studio-behavior, finding:foundry-public-studio-delivery)
- Initial fill precedes user iteration (finding:foundry-public-studio-mission)

## Watch
- If changes made outside the owning agent > 0 in any review, then return them to that agent.
