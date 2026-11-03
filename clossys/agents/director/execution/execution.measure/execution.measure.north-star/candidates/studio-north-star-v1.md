---
slot: "execution.measure.north-star"
source: {"kind":"derived","ref":["finding:foundry-public-repo-facts"]}
feeds: []
functions: ["product"]
note: "Unpinned initial-fill draft for the public Foundry Studio, derived from the public repository and Studio checklist findings; not approved and not evidence of shipped behavior."
---

## Direction
- Metric: the share of slots in a workspace that hold a pinned candidate with a traced source.
- Target: NEED: the owner sets the target and date; the long-term goal is full pinned coverage.
- Why: a pinned, traced slot is direction a team has chosen and an agent can build on, which is the value Foundry promises.

## Because
- Pins and sources are recorded per slot (finding:foundry-public-repo-facts)
- The long-term goal is pinned coverage in aspiration.goal.long-term (finding:foundry-public-repo-facts)

## Watch
- If pinned share falls below a prior owner review's value in any review, then report which slots lost their pin.
