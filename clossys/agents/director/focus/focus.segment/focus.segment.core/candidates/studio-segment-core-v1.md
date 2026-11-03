---
slot: "focus.segment.core"
source: {"kind":"derived","ref":["finding:foundry-public-repo-facts","finding:foundry-public-studio-readonly-bound","finding:foundry-public-studio-exclusions"]}
feeds: []
functions: ["gtm","product"]
note: "Unpinned initial-fill draft for the public Foundry Studio, derived from the public repository and Studio checklist findings; not approved and not evidence of shipped behavior."
---

## Direction
- Who: small product teams and solo technical founders who keep their product in an npm workspace and already work with a coding agent.
- Situation: they need a design system, copy and a few pages for a new product, and want the agent to build them from a sourced brief.
- Not: teams that want a hosted visual editor or no-code builder; Studio is read-only and changes go through agents.

## Because
- Foundry installs as npm packages and runs through a CLI (finding:foundry-public-repo-facts)
- Studio offers read-only inspection with no forms or saves (finding:foundry-public-studio-readonly-bound, finding:foundry-public-studio-exclusions)

## Watch
- If owner-reported requests for in-Studio editing > 3 in any month, then review whether this segment is drawn too wide.
