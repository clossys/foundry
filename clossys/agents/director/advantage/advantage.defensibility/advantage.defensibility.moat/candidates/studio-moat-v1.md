---
slot: "advantage.defensibility.moat"
source: {"kind":"derived","ref":["finding:foundry-public-repo-facts","finding:foundry-public-studio-delivery","finding:foundry-owner-answers-2026-11-03"]}
feeds: []
functions: ["product"]
note: "Unpinned initial-fill draft for the public Foundry Studio, derived from the public repository, Studio checklist findings and owner answers of 2026-11-03; not approved and not evidence of shipped behavior."
---

## Direction
- Moat: a workspace's pinned slots and their history, which every new page and check builds on.
- Mechanism: each pin makes the next page cheaper to assemble and each check catches drift against it, so the records gain value with use.
- Milestone: 5 consumer workspaces live with every slot pinned.

## Because
- Pins are recorded with a hash and an owner, and pages assemble from pinned work (finding:foundry-public-repo-facts, finding:foundry-public-studio-delivery)
- The owner set the milestone (finding:foundry-owner-answers-2026-11-03)

## Watch
- If live workspaces with every slot pinned < 5 by 2026-12-31, then report that the moat is not yet forming.
