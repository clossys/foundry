---
slot: "capability.resource.allocation"
source: {"kind":"derived","ref":["finding:foundry-public-studio-delivery","finding:foundry-public-repo-facts"]}
feeds: []
functions: ["ops"]
note: "Unpinned initial-fill draft for the public Foundry Studio, derived from the public repository and Studio checklist findings; not approved and not evidence of shipped behavior."
---

## Direction
- Split: NEED: no percentage split is recorded; this draft states the rule only.
- Rule: initial fill of empty slots comes before polish, and Director work comes before Designer and Writer, which come before Publisher.
- Reserve: owner review time for pins, which agents cannot spend.

## Because
- Delivery order is Director to Designer and Writer to Publisher (finding:foundry-public-studio-delivery)
- The current bet is initial fill in execution.priority.bet (finding:foundry-public-repo-facts)

## Watch
- If downstream work starts with upstream slots at zero candidates > 0 times in any review, then pause it until the upstream fill lands.
