---
slot: "context.customer.need"
source: {"kind":"derived","ref":["finding:foundry-public-studio-mission","finding:foundry-public-repo-facts"]}
feeds: []
functions: ["product"]
note: "Unpinned initial-fill draft for the public Foundry Studio, derived from the public repository and Studio checklist findings; not approved and not evidence of shipped behavior."
---

## Direction
- Job: turn a short brief into a published design system, copy and pages without hand-building each piece.
- Pain: direction, visuals, copy and pages drift apart because each lives in a different tool, and nobody can say where a choice came from.
- Trigger: a team starts a new product or site and wants a coding agent to build it, but has no sourced brief the agent can cite.
- Only grounded inputs count: an agent works from cleared upstream candidates rather than from empty or invented work.

## Because
- The Studio mission draft names users iterating from cleared candidates instead of empty or invented work (finding:foundry-public-studio-mission)
- Foundry checks run against what is on disk, and Writer resolves only approved copy, which answers the provenance pain (finding:foundry-public-repo-facts)

## Watch
- If Studio slots with zero candidates > 0 at any readiness report, then treat the need as unmet for that workspace and report the empty slots.
