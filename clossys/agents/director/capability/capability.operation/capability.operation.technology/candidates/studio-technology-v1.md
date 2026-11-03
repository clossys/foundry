---
slot: "capability.operation.technology"
source: {"kind":"derived","ref":["finding:foundry-public-repo-facts","finding:foundry-public-studio-delivery","finding:foundry-public-studio-behavior"]}
feeds: []
functions: ["tech"]
note: "Unpinned initial-fill draft for the public Foundry Studio, derived from the public repository and Studio checklist findings; not approved and not evidence of shipped behavior."
---

## Direction
- Strategic: the slot model, the slot contracts, the agent gates and the `clossys` CLI, which Foundry owns and invests in.
- Commodity: npm, React, shadcn and its trusted registries, and the coding agents themselves, which Foundry uses rather than builds.
- Rule: own what makes output traceable; adopt anything that already has a trusted reference.

## Because
- Foundry ships the slot model, CLI and gates (finding:foundry-public-repo-facts)
- Designer adopts from shadcn and trusted registries (finding:foundry-public-studio-delivery, finding:foundry-public-studio-behavior)

## Watch
- If Foundry-built components that have a trusted reference > 0 in any Designer check, then replace them with the adopted reference.
