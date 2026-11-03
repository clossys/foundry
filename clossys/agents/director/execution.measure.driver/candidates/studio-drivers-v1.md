---
slot: "execution.measure.driver"
source: {"kind":"derived","ref":["finding:foundry-public-repo-facts","finding:foundry-owner-answers-2026-11-03"]}
feeds: []
functions: ["product"]
note: "Unpinned initial-fill draft for the public Foundry Studio, derived from the public repository, Studio checklist findings and owner answers of 2026-11-03; not approved and not evidence of shipped behavior."
---

## Direction
- Drivers: slots with at least one candidate; slots with an owner pin; slot check passing.
- Targets: all L3 slots of all four agents with a candidate and an owner pin by 2026-11-06; slot check exit 0 on every commit.
- Owner: Director owns candidate coverage, the owner owns reviews and pins, and the integrator owns the slot check.

## Because
- The IA count and slot check are in the tree (finding:foundry-public-repo-facts)
- The owner set the review and pin target (finding:foundry-owner-answers-2026-11-03)

## Watch
- If the slot check exit code > 0 on any integrated head, then stop merges until it passes.
