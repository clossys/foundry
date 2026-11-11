---
slot: "capability.operation.delivery"
source: {"kind": "derived", "ref": ["finding:owner-foundry-director-2026-11-11", "finding:owner-delivery-2026-11-11"]}
feeds: []
functions: ["ops"]
note: "Option B: the same chain, held to public CI."
---

## Direction
- Steps: Director, then Designer, then Writer, then Publisher; plumb steps run on their own.
- Standard: done means the strict check passes in public CI on the repository, with no private access.
- Owner: the Director is accountable for delivery; the owner decides only at decide steps.
- Only public CI counts, rather than a local run.

## Because
- The owner wants Foundry content independent, with nothing hard-linked elsewhere (finding:owner-foundry-director-2026-11-11)
- The owner picked the chain in order, owner only at decisions (finding:owner-delivery-2026-11-11)

## Watch
- If strict checks that need private access to run > 0 in any month, then make them run on the public tree alone.
