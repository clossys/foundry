---
slot: "execution.roadmap.release"
source: {"kind":"derived","ref":["finding:foundry-public-repo-facts","focus.lifecycle.acquisition@1"]}
feeds: []
functions: ["product","gtm"]
note: "Initial-fill draft for the public Foundry Studio, derived from the public repository and Studio checklist findings; not approved and not evidence of shipped behavior. v2 (Director re-draft 2026-11-11): Watch rewritten to the by/each/in any window grammar; Because cites focus.lifecycle.acquisition@1 (Acquisition-Release link); Direction unchanged."
---

## Direction
- Release: the next public `@clossys` package release with the Studio and the filled Director slots.
- Audience: developers and technical founders who install from public npm.
- Channel: the public npm registry and the public repository.

## Because
- Packages release publicly on npm (finding:foundry-public-repo-facts)
- Acquisition runs through the repository and npm (focus.lifecycle.acquisition@1)

## Watch
- If releases shipped with a failing slot check > 0 in any release review, then hold the next release until it passes.
