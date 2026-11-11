---
slot: "execution.measure.driver"
source: {"kind":"derived","ref":["execution.measure.north-star@2","capability.operation.delivery@2","execution.priority.bet@2","finding:owner-noncore-2026-11-11"]}
feeds: []
functions: ["product"]
note: "Agent pick under the owner's W5 rule 'Agent picks, no review' (owner chat 2026-11-11 W5 interview); re-drafted from the 24 owner answers."
---

## Direction
- Drivers: hand edits per Studio rebuild; strict checks failing on the integrated head; owner decisions per shipped page.
- Targets: zero hand edits and zero failing strict checks by 2026-12-31; owner decisions only at decide steps.
- Owner: the integrator owns the strict checks, each agent owns its own steps, and the owner owns the decide steps.

## Because
- The north star counts owner decisions per shipped page, with zero hand edits by 2026-12-31 (execution.measure.north-star@2)
- Done means the strict check passes (capability.operation.delivery@2)
- The bet is Studio built natively by the chain (execution.priority.bet@2)
- The owner let Director re-draft and pick the non-core cells (finding:owner-noncore-2026-11-11)

## Watch
- If hand edits per Studio rebuild > 0 by 2026-12-31, then report each one and the step that needed it.
