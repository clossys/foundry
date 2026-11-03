---
slot: "capability.sourcing.build"
source: {"kind":"derived","ref":["finding:foundry-public-repo-facts","finding:foundry-public-studio-offer"]}
feeds: []
functions: ["tech"]
note: "Unpinned initial-fill draft for the public Foundry Studio, derived from the public repository and Studio checklist findings; not approved and not evidence of shipped behavior."
---

## Direction
- Build: the agents' contracts and gates, the slot model and its check, the CLI and the read-only Studio.
- Why: no existing tool links direction, design, copy and pages by provenance, so this layer must be built rather than bought.
- Cost: sustained maintenance of four packages and their gates, and slower starts than an unguided generator.

## Because
- These are the packages in the public tree (finding:foundry-public-repo-facts)
- The gap is cross-layer provenance (finding:foundry-public-studio-offer)

## Watch
- If a built piece duplicates a trusted reference > 0 times in any review, then adopt the reference and drop the built piece.
