---
slot: "capability.team.role"
source: {"kind": "derived", "ref": ["capability.operation.delivery@4", "finding:foundry-public-repo-facts"]}
feeds: []
functions: ["people"]
note: "Agent pick for the Foundry open-source project Director (C6-FDIR, 2026-11-11): project answer, cites the recommended project core options; re-cite when the owner picks."
---

## Direction
- Roles: the maintainer, who sets direction and makes the decide-step calls; four agents (Director, Designer, Writer, Publisher); and outside contributors.
- Who: the maintainer is a person; agent roles are held by coding agents running the skills; contributors work through public pull requests.
- Next-hire: none; agents and public contributors only.

## Because
- The owner decides only at decide steps (capability.operation.delivery@4)
- The repository is public, so contributors can send pull requests (finding:foundry-public-repo-facts)

## Watch
- If outside pull requests waiting over 14 days for a first reply > 0 in any month, then review this cell.
