---
slot: "capability.team.role"
source: {"kind":"derived","ref":["finding:foundry-public-repo-facts","finding:foundry-owner-answers-2026-11-03"]}
feeds: []
functions: ["people"]
note: "Initial-fill draft for the public Foundry Studio, derived from the public repository, Studio checklist findings and owner answers of 2026-11-03; not approved and not evidence of shipped behavior. v2 (Director re-draft 2026-11-11): Watch rewritten to the by/each/in any window grammar; Direction unchanged."
---

## Direction
- Roles: the owner who pins slots and sets direction, and the four agents: Director for direction, Designer for visuals, Writer for copy, Publisher for assembly.
- Who: the owner is a person; the agent roles are held by coding agents running the agent skills.
- Next-hire: none; agents only until the 5 consumer workspaces are live.

## Because
- Pins name `pinnedBy` an owner (finding:foundry-public-repo-facts)
- The owner set no hire until the 5 workspaces are live (finding:foundry-owner-answers-2026-11-03)

## Watch
- If live consumer workspaces reaches 5 in any owner review, then ask the owner whether to open a human role.
