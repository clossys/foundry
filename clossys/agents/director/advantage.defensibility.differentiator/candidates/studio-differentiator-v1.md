---
slot: "advantage.defensibility.differentiator"
source: {"kind":"derived","ref":["finding:foundry-public-repo-facts","finding:foundry-public-studio-behavior"]}
feeds: []
functions: ["product","tech"]
note: "Unpinned initial-fill draft for the public Foundry Studio, derived from the public repository and Studio checklist findings; not approved and not evidence of shipped behavior."
---

## Direction
- Difference: four agents with separate jobs, each with its own contract and gate, and one read-only Studio to inspect them, rather than one generator doing everything.
- Versus: single-prompt site generators and hosted design tools.
- Why-hard: the slot contracts, the leaf-frozen IA and the checks take sustained work to build, and they only pay off once the four agents share them.

## Because
- Director, Designer, Writer and Publisher are separate packages with separate gates (finding:foundry-public-repo-facts)
- Visual, copy and assembly ownership is split between the agents (finding:foundry-public-studio-behavior)
- The promise is traced output in advantage.proposition.promise (finding:foundry-public-repo-facts)

## Watch
- If a downstream agent writes into another agent's slots > 0 times in any check, then report the boundary breach.
