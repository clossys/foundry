---
slot: "capability.resource.allocation"
source: {"kind": "derived", "ref": ["finding:owner-foundry-director-2026-11-11", "execution.priority.bet@6", "capability.operation.delivery@7"]}
feeds: []
functions: ["ops"]
note: "Agent pick for the Foundry open-source project Director (R2F-L2 public scrub, 2026-11-12): adapted from v10; the split percentages are dropped for want of a public basis, the Rule loses its percentage and the Reserve is kept."
---

## Direction
- Split: engine and Studio first, then filling Studio's own workspace, then docs and release; no percentages are set in the public record.
- Rule: Studio first; filling work goes to Studio's own workspace before any other, and no work for outside projects until Studio rebuilds from one brief with zero hand edits.
- Reserve: owner time only for decide steps; the agents run the rest.

## Because
- The owner said to focus on Foundry and run the full loop on Studio first (finding:owner-foundry-director-2026-11-11)
- The bet puts Studio first, rather than features for outside projects (execution.priority.bet@6)
- The owner is asked only at decide steps (capability.operation.delivery@7)

## Watch
- If merged pull requests for outside-project features > 0 by 2026-12-31, then stop that work and return it to the Studio rebuild.
