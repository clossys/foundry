---
slot: "capability.sourcing.partner"
source: {"kind":"derived","ref":["finding:foundry-public-repo-facts","finding:foundry-public-studio-delivery"]}
feeds: []
functions: ["tech","ops"]
note: "Unpinned initial-fill draft for the public Foundry Studio, derived from the public repository and Studio checklist findings; not approved and not evidence of shipped behavior."
---

## Direction
- Partner: the npm registry, shadcn and its registries, and the coding agents that run the CLI and skills.
- Gives: distribution, trusted component references and the labor that fills and checks slots.
- Risk: if a registry or agent changes terms, installs or fills stop; the records stay on disk, so the work survives.

## Because
- Packages ship through public npm and Designer adopts from trusted registries (finding:foundry-public-repo-facts, finding:foundry-public-studio-delivery)

## Watch
- If a partner terms change that blocks install or fill > 0 times in any quarter, then record it as a finding and draft a mitigation.
