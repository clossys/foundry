---
slot: "execution.roadmap.milestone"
source: {"kind":"derived","ref":["finding:foundry-public-repo-facts","finding:foundry-public-studio-delivery","finding:foundry-owner-answers-2026-11-03"]}
feeds: []
functions: ["product"]
note: "Initial-fill draft for the public Foundry Studio, derived from the public repository, Studio checklist findings and owner answers of 2026-11-03; not approved and not evidence of shipped behavior. v2 (Director re-draft 2026-11-11): Watch rewritten to the by/each/in any window grammar; Direction unchanged."
---

## Direction
- Milestone: all 57 Director slots hold at least one candidate and `clossys migrate slots --check` passes.
- Date: 2026-11-06.
- Evidence: the slot check exit code and a count of slots with candidates, shown in Studio on the integrated head.

## Because
- The Director IA has 57 slots and a slot check (finding:foundry-public-repo-facts)
- Rows count only after browser checks on the integrated head (finding:foundry-public-studio-delivery)
- The owner moved the date to 2026-11-06 (finding:foundry-owner-answers-2026-11-03)

## Watch
- If Director slots with zero candidates > 0 by 2026-11-06, then report the remaining slots and ask the owner for a new date.
