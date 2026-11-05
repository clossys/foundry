---
slot: "context.market.size"
source: {"kind":"derived","ref":["finding:foundry-public-repo-facts","finding:foundry-owner-answers-2026-11-03"]}
feeds: []
functions: ["gtm"]
note: "Unpinned initial-fill draft for the public Foundry Studio, derived from the public repository, Studio checklist findings and owner answers of 2026-11-03; not approved and not evidence of shipped behavior."
---

## Direction
- Unit: teams that keep their product repository in an npm workspace and already let a coding agent change it; counted as workspaces, not seats.
- Reachable: founders building with coding agents, stated in words with no count rather than an invented number.
- Method: qualitative, from the owner's segment statement; a count is added only once a dated source exists.

## Because
- Foundry ships as npm packages and a `clossys` CLI, so a workspace is the unit that installs it (finding:foundry-public-repo-facts)
- The owner set the segment in words and a qualitative method with no count (finding:foundry-owner-answers-2026-11-03)

## Watch
- If findings that carry a dated workspace count > 0 in any quarter, then propose a v2 of this slot that adds the count with its source.
