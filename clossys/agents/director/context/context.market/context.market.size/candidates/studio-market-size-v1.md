---
slot: "context.market.size"
source: {"kind":"derived","ref":["finding:foundry-public-repo-facts"]}
feeds: []
functions: ["gtm"]
note: "Unpinned initial-fill draft for the public Foundry Studio, derived from the public repository and Studio checklist findings; not approved and not evidence of shipped behavior."
---

## Direction
- Unit: teams that keep their product repository in an npm workspace and already let a coding agent change it; counted as workspaces, not seats.
- Reachable: NEED: no count is recorded; the public tree holds no market sizing, so this draft names the unit only rather than inventing a number.
- Method: NEED: derive the count from a dated public source, such as public npm workspace download data, and record it as a finding before this slot is pinned.

## Because
- Foundry ships as npm packages and a `clossys` CLI, so a workspace is the unit that installs it (finding:foundry-public-repo-facts)
- The public tree records no market sizing, so Reachable and Method stay NEED (finding:foundry-public-repo-facts)

## Watch
- If findings that carry a dated workspace count = 0 by 2026-12-31, then keep this slot unpinned and report the missing source.
