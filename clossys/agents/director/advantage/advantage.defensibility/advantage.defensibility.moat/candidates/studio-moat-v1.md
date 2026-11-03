---
slot: "advantage.defensibility.moat"
source: {"kind":"derived","ref":["finding:foundry-public-repo-facts","finding:foundry-public-studio-delivery"]}
feeds: []
functions: ["product"]
note: "Unpinned initial-fill draft for the public Foundry Studio, derived from the public repository and Studio checklist findings; not approved and not evidence of shipped behavior."
---

## Direction
- Moat: a workspace's pinned slots and their history, which every new page and check builds on.
- Mechanism: each pin makes the next page cheaper to assemble and each check catches drift against it, so the records gain value with use.
- Milestone: NEED: no threshold is recorded; a candidate marker is a workspace with all 57 Director slots pinned.

## Because
- Pins are recorded with a hash and an owner, and pages assemble from pinned work (finding:foundry-public-repo-facts, finding:foundry-public-studio-delivery)

## Watch
- If workspaces with all Director slots pinned = 0 by 2026-12-31, then report that the moat is not yet forming.
