---
slot: "advantage.defensibility.differentiator"
source: {"kind":"derived","ref":["finding:foundry-public-repo-facts","finding:foundry-public-studio-behavior"]}
feeds: []
functions: ["product","tech"]
note: "Alternative human framing of the pinned candidate's direction on the same recorded findings; unpinned draft for owner choice."
vary: {"angle":"human"}
---

## Direction
- Difference: you always know which agent made a piece and why, because each of the four agents has its own job, contract and gate, and Studio shows the work read-only.
- Versus: single-prompt site generators and hosted design tools.
- Why-hard: the slot contracts, the leaf-frozen IA and the checks take sustained work to build, and they only pay off once the four agents share them.

## Because
- Director, Designer, Writer and Publisher are separate packages with separate gates (finding:foundry-public-repo-facts)
- Visual, copy and assembly ownership is split between the agents (finding:foundry-public-studio-behavior)
- The promise is traced output in advantage.proposition.promise (finding:foundry-public-repo-facts)

## Watch
- If a downstream agent writes into another agent's slots > 0 times in any check, then report the boundary breach.
