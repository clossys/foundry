---
slot: "execution.roadmap.milestone"
source: {"kind":"derived","ref":["finding:foundry-public-repo-facts","finding:foundry-public-studio-delivery"]}
feeds: []
functions: ["product"]
note: "Unpinned initial-fill draft for the public Foundry Studio, derived from the public repository and Studio checklist findings; not approved and not evidence of shipped behavior."
---

## Direction
- Milestone: all 57 Director slots hold at least one candidate and `clossys migrate slots --check` passes.
- Date: 2026-11-30, proposed by this draft and open to owner change.
- Evidence: the slot check exit code and a count of slots with candidates, shown in Studio on the integrated head.

## Because
- The Director IA has 57 slots and a slot check (finding:foundry-public-repo-facts)
- Rows count only after browser checks on the integrated head (finding:foundry-public-studio-delivery)

## Watch
- If Director slots with zero candidates > 0 on 2026-11-30, then report the remaining slots and propose a new date to the owner.
