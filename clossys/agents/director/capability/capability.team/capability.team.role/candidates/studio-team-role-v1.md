---
slot: "capability.team.role"
source: {"kind":"derived","ref":["finding:foundry-public-repo-facts","finding:foundry-public-studio-behavior","finding:foundry-public-studio-delivery"]}
feeds: []
functions: ["people"]
note: "Unpinned initial-fill draft for the public Foundry Studio, derived from the public repository and Studio checklist findings; not approved and not evidence of shipped behavior."
---

## Direction
- Roles: the owner who pins slots and sets direction, and the four agents: Director for direction, Designer for visuals, Writer for copy, Publisher for assembly.
- Who: the owner is a person; the agent roles are held by coding agents running the agent skills.
- Next-hire: NEED: no human hire is recorded in this public record.

## Because
- Pins name `pinnedBy` an owner (finding:foundry-public-repo-facts)
- Visual, copy and assembly ownership is split between Designer, Writer and Publisher (finding:foundry-public-studio-behavior, finding:foundry-public-studio-delivery)

## Watch
- If slots pinned by an agent rather than an owner > 0 in any slot check, then remove the pin and report it.
