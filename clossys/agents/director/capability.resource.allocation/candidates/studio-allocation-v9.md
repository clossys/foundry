---
slot: "capability.resource.allocation"
source: {"kind": "derived", "ref": ["finding:foundry-owner-answers-2026-11-03", "execution.priority.bet@6", "capability.operation.delivery@4"]}
feeds: []
functions: ["ops"]
note: "Agent pick for the Foundry open-source project Director (DIR-FIX, 2026-11-11): adapted from v8; the owner's 50/40/10 split now points at Studio first, and the Watch counts merged work instead of an unmeasured share."
---

## Direction
- Split: 50% engine and Studio, 40% filling and publishing Studio's own workspace from one brief, 10% docs and release.
- Rule: Studio first; no work for outside projects until Studio rebuilds from one brief with zero hand edits.
- Reserve: owner time only for decide steps; the agents run the rest.

## Because
- The owner set the 50/40/10 split (finding:foundry-owner-answers-2026-11-03)
- The bet puts Studio first, rather than features for outside projects (execution.priority.bet@6)
- The owner is asked only at decide steps (capability.operation.delivery@4)

## Watch
- If merged pull requests for outside-project features > 0 by 2026-12-31, then stop that work and return it to the Studio rebuild.
