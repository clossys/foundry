---
slot: "capability.sourcing.acquire"
source: {"kind":"derived","ref":["finding:foundry-public-repo-facts","finding:foundry-owner-answers-2026-11-03"]}
feeds: []
functions: ["corp-dev"]
note: "Unpinned initial-fill draft for the public Foundry Studio, derived from the public repository, Studio checklist findings and owner answers of 2026-11-03; not approved and not evidence of shipped behavior."
---

## Direction
- Target: none planned; Foundry adopts open-source references rather than buying capability.
- Trigger: a missing capability that a free, trusted registry already covers (planner default, open to owner change).
- Limit: free or open-licence sources only, never a paid acquisition (planner default, open to owner change).

## Because
- The public tree records adoption of references, not acquisitions (finding:foundry-public-repo-facts)
- Trigger and Limit are planner defaults recorded with the owner answers (finding:foundry-owner-answers-2026-11-03)

## Watch
- If an acquisition with a paid licence is proposed > 0 times in any review, then refuse it and route the question to the owner.
