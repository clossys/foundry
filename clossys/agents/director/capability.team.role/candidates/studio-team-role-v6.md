---
slot: "capability.team.role"
source: {"kind": "derived", "ref": ["capability.operation.delivery@7", "finding:foundry-public-repo-facts"]}
feeds: []
functions: ["people"]
note: "Citation-only re-cite (CASCADE, 2026-11-11): Delivery v7 is the pinned v4 meaning re-addressed (owner r9); text unchanged."
---

## Direction
- Roles: the maintainer, who sets direction and makes the decide-step calls; four agents (Director, Designer, Writer, Publisher); and outside contributors.
- Who: the maintainer is a person; agent roles are held by coding agents running the skills; contributors work through public pull requests.
- Next-hire: none; agents and public contributors only.

## Because
- The owner decides only at decide steps (capability.operation.delivery@7)
- The repository is public, so contributors can send pull requests (finding:foundry-public-repo-facts)

## Watch
- If outside pull requests waiting over 14 days for a first reply > 0 in any month, then review this cell.
