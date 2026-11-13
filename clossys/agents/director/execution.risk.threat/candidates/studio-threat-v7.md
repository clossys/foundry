---
slot: "execution.risk.threat"
source: {"kind": "derived", "ref": ["execution.priority.bet@6", "execution.measure.north-star@4", "finding:foundry-public-repo-facts"]}
feeds: []
functions: ["ops"]
note: "Agent pick for the Foundry open-source project Director (C6-FDIR fix round 1, 2026-11-11): re-drafted after the critic's reading; cites the recommended project core options; re-cite when the owner picks."
---

## Direction
- Threat: the chain still needs hand edits on 2026-12-31, so Studio cannot be rebuilt from one brief.
- Likelihood: medium, because no Studio rebuild from one brief has run end to end yet.
- Impact: the bet's kill rule fires, and outside developers see an engine that cannot build its own app.
- Ranked below: a private detail leaking into the public repository, which the public-safety gate guards.

## Because
- The bet's kill rule fires if hand edits remain on 2026-12-31 (execution.priority.bet@6)
- The north star needs zero hand edits by 2026-12-31 (execution.measure.north-star@4)
- The repository is public (finding:foundry-public-repo-facts)

## Watch
- If hand edits needed in a Studio rebuild > 0 by 2026-12-31, then apply the bet's kill rule and rethink the chain with the owner.
