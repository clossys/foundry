---
slot: "execution.risk.threat"
source: {"kind":"derived","ref":["finding:foundry-public-repo-facts","finding:foundry-public-studio-mission","finding:foundry-public-studio-essence"]}
feeds: []
functions: ["product"]
note: "Unpinned initial-fill draft for the public Foundry Studio, derived from the public repository and Studio checklist findings; not approved and not evidence of shipped behavior."
---

## Direction
- Threat: filled candidates read as approved direction even though they are unpinned drafts.
- Likelihood: medium, because a filled slot looks finished in Studio.
- Impact: Designer and Writer would build on unapproved direction and the traceability promise would break.

## Because
- Candidates carry no approval state; only a pin approves (finding:foundry-public-repo-facts)
- Existing drafts state they are unpinned and not approved (finding:foundry-public-studio-mission, finding:foundry-public-studio-essence)

## Watch
- If downstream candidates citing an unpinned Director slot as approved > 0 in any check, then flag them for owner review.
