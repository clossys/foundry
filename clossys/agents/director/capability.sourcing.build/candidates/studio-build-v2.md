---
slot: "capability.sourcing.build"
source: {"kind":"derived","ref":["finding:foundry-public-repo-facts","finding:foundry-public-studio-offer"]}
feeds: []
functions: ["tech"]
note: "Unpinned initial-fill draft for the public Foundry Studio, derived from the public repository and Studio checklist findings; not approved and not evidence of shipped behavior. v2 (Director re-draft 2026-11-11): Watch period set to a calendar window the review loop schedules (in any month); Direction and Because unchanged."
---

## Direction
- Build: the agents' contracts and gates, the slot model and its check, the CLI and the read-only Studio.
- Why: no existing tool links direction, design, copy and pages by provenance, so this layer must be built rather than bought.
- Cost: sustained maintenance of four packages and their gates, and slower starts than an unguided generator.

## Because
- These are the packages in the public tree (finding:foundry-public-repo-facts)
- The gap is cross-layer provenance (finding:foundry-public-studio-offer)

## Watch
- If built pieces that duplicate a trusted reference > 0 in any month, then adopt the reference and drop the built piece.
