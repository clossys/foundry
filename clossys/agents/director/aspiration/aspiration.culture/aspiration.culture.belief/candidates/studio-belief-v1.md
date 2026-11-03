---
slot: "aspiration.culture.belief"
source: {"kind":"derived","ref":["finding:foundry-public-studio-essence","finding:foundry-public-repo-facts"]}
feeds: []
functions: ["product","people"]
note: "Unpinned initial-fill draft for the public Foundry Studio, derived from the public repository and Studio checklist findings; not approved and not evidence of shipped behavior."
---

## Direction
- Belief: pick, never invent: every visual starts from a trusted reference and every claim starts from a recorded source.
- Contrast: many teams believe original work is the point and generated work is good enough without provenance.
- Cost: it is slower to start, a missing reference stays a NEED rather than a quick guess, and some ideas wait for the owner.

## Because
- The essence draft records Pick, never invent and keeps missing references as NEED (finding:foundry-public-studio-essence)
- Facts in Director records need a source finding (finding:foundry-public-repo-facts)

## Watch
- If candidates with no source ref > 0 in any slot check, then treat the belief as broken and return the candidate to its agent.
