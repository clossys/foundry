---
slot: "capability.sourcing.acquire"
source: {"kind": "derived", "ref": ["finding:foundry-public-repo-facts", "finding:foundry-public-studio-delivery"]}
feeds: []
functions: ["corp-dev"]
note: "Agent pick for the Foundry open-source project Director (C6-FDIR, 2026-11-11): project answer, cites the recommended project core options; re-cite when the owner picks."
---

## Direction
- Target: none; Foundry adopts open-source references rather than buying capability.
- Trigger: a missing capability that a free, trusted registry already covers.
- Limit: free or open-licence sources only, never a paid acquisition.

## Because
- The public tree records adoption of references, not acquisitions (finding:foundry-public-repo-facts)
- Designer adopts from trusted registries (finding:foundry-public-studio-delivery)

## Watch
- If acquisitions with a paid licence proposed > 0 in any month, then refuse them and route the question to the owner.
