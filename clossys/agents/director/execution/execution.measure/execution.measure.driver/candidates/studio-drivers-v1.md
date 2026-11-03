---
slot: "execution.measure.driver"
source: {"kind":"derived","ref":["finding:foundry-public-repo-facts"]}
feeds: []
functions: ["product"]
note: "Unpinned initial-fill draft for the public Foundry Studio, derived from the public repository and Studio checklist findings; not approved and not evidence of shipped behavior."
---

## Direction
- Drivers: slots with at least one candidate; candidates reviewed by the owner; slot check passing.
- Targets: 57 of 57 Director slots with a candidate; NEED: review and pin targets are set by the owner; slot check exit 0 on every commit.
- Owner: Director owns candidate coverage, the owner owns reviews and pins, and the integrator owns the slot check.

## Because
- The IA count and slot check are in the tree (finding:foundry-public-repo-facts)
- Pins name an owner (finding:foundry-public-repo-facts)

## Watch
- If the slot check exit code > 0 on any integrated head, then stop merges until it passes.
