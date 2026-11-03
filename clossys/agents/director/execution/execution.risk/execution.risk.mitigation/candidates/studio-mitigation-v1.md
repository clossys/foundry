---
slot: "execution.risk.mitigation"
source: {"kind":"derived","ref":["finding:foundry-public-studio-offer","finding:foundry-public-repo-facts"]}
feeds: []
functions: ["product"]
note: "Unpinned initial-fill draft for the public Foundry Studio, derived from the public repository and Studio checklist findings; not approved and not evidence of shipped behavior."
---

## Direction
- Threat: unpinned candidates mistaken for approved direction.
- Action: every candidate note says unpinned and not approved, unknowns stay NEED, and Studio shows pin state on every L3 card.
- Owner: Director writes the notes; the owner approves pins; Designer shows pin state on the card.

## Because
- The card shows name, version and status (finding:foundry-public-studio-offer)
- Pins are owner decisions (finding:foundry-public-repo-facts)

## Watch
- If candidates missing an unpinned note > 0 in any Director review, then add it in a new candidate version.
