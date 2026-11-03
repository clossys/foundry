---
slot: "identity.verbal.narrative"
source: {"kind":"derived","ref":["finding:foundry-public-repo-facts","finding:foundry-public-studio-readonly-bound"]}
feeds: []
functions: ["brand","gtm"]
note: "Unpinned initial-fill draft for the public Foundry Studio, derived from the public repository and Studio checklist findings; not approved and not evidence of shipped behavior."
---

## Direction
- Change: coding agents can now build design systems, copy and pages, so the bottleneck moves from making things to knowing where they came from.
- Stakes: teams that ignore it ship pages nobody can trace, and every change becomes a guess about what else breaks.
- Way: give each agent one job and a contract, keep every choice as a slot with candidates and an owner pin, and inspect it all in a read-only Studio.

## Because
- The shift toward agent-operated repositories is the context trend draft (finding:foundry-public-repo-facts)
- The slot model and read-only Studio are the way through (finding:foundry-public-repo-facts, finding:foundry-public-studio-readonly-bound)

## Watch
- If narrative copy that claims shipped behavior not checked in the browser > 0 in any review, then revise it against the checklist.
