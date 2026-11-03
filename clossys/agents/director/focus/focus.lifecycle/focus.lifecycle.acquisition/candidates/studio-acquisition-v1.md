---
slot: "focus.lifecycle.acquisition"
source: {"kind":"derived","ref":["finding:foundry-public-studio-delivery","finding:foundry-public-studio-mission","finding:foundry-public-repo-facts"]}
feeds: []
functions: ["gtm"]
note: "Unpinned initial-fill draft for the public Foundry Studio, derived from the public repository and Studio checklist findings; not approved and not evidence of shipped behavior."
---

## Direction
- Path: find the repository or a package on npm, read the README, install, run the `clossys` CLI on a workspace, open the localhost Studio and see the filled slots.
- Hook: a filled candidate in every slot on first run, rather than an empty template.
- Cost: estimated as one install and one CLI run of effort for the user; NEED: no measured time or spend is recorded.

## Because
- Initial fill puts a candidate in each empty slot before the user iterates (finding:foundry-public-studio-delivery, finding:foundry-public-studio-mission)
- Install is from public npm without authentication (finding:foundry-public-repo-facts)

## Watch
- If first runs that leave slots with zero candidates > 0 in any release check, then fix initial fill before promoting the hook.
