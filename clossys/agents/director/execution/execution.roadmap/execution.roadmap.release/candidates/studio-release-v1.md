---
slot: "execution.roadmap.release"
source: {"kind":"derived","ref":["finding:foundry-public-repo-facts"]}
feeds: []
functions: ["product","gtm"]
note: "Unpinned initial-fill draft for the public Foundry Studio, derived from the public repository and Studio checklist findings; not approved and not evidence of shipped behavior."
---

## Direction
- Release: the next public `@clossys` package release with the Studio and the filled Director slots.
- Audience: developers and technical founders who install from public npm.
- Channel: the public npm registry and the public repository.

## Because
- Packages release publicly on npm (finding:foundry-public-repo-facts)
- Acquisition runs through the repository and npm in focus.lifecycle.acquisition (finding:foundry-public-repo-facts)

## Watch
- If a release ships with a failing slot check > 0 times, then hold the next release until it passes.
