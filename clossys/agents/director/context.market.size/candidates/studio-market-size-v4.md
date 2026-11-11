---
slot: "context.market.size"
source: {"kind": "derived", "ref": ["focus.segment.core@3", "aspiration.goal.long-term@3", "finding:foundry-public-repo-facts"]}
feeds: []
functions: ["gtm"]
note: "Agent pick for the Foundry open-source project Director (C6-FDIR, 2026-11-11): project answer, cites the recommended project core options; re-cite when the owner picks."
---

## Direction
- Unit: outside projects that build a site with the clossys CLI, counted as projects rather than downloads.
- Reachable: 3 outside projects inside the 2027-06-30 horizon, the long-term target.
- Method: count public repositories or sites whose records cite the clossys CLI at each release; npm downloads are a signal, not a count.

## Because
- The core segment is developers building with coding agents (focus.segment.core@3)
- The long-term target is 3 outside projects by 2027-06-30 (aspiration.goal.long-term@3)
- The public tree holds no market sizing, so the count starts from the project's own measure (finding:foundry-public-repo-facts)

## Watch
- If outside projects found using the packages < 1 by 2027-03-31, then report the count to the owner.
