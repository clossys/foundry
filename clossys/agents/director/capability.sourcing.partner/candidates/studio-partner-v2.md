---
slot: "capability.sourcing.partner"
source: {"kind": "derived", "ref": ["finding:foundry-public-repo-facts", "finding:foundry-public-studio-delivery"]}
feeds: []
functions: ["ops"]
note: "Agent pick for the Foundry open-source project Director (C6-FDIR, 2026-11-11): project answer, cites the recommended project core options; re-cite when the owner picks."
---

## Direction
- Partner: the npm registry, the public code host and its CI, shadcn and its registries, and the coding agents that run the CLI and skills.
- Gives: distribution, public CI, trusted component references and the labour that fills and checks slots.
- Risk: if a registry, host or agent changes terms, installs or fills stop; the records stay on disk, so the work survives.

## Because
- Packages ship through public npm and the repository is public (finding:foundry-public-repo-facts)
- Designer adopts from trusted registries (finding:foundry-public-studio-delivery)

## Watch
- If partner terms changes that block install or fill > 0 in any quarter, then record it as a finding and draft a mitigation.
