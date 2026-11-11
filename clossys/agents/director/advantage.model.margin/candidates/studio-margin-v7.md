---
slot: "advantage.model.margin"
source: {"kind": "derived", "ref": ["advantage.model.pricing@5", "finding:foundry-public-repo-facts"]}
feeds: []
functions: ["finance"]
note: "Agent pick for the Foundry open-source project Director (DIR-REC, 2026-11-11): adapted from v6 after the critic's reading; the Watch counts only re-fills whose pinned inputs did not change, so a rebuild from a new brief is not flagged."
---

## Direction
- Unit: one project running the packages.
- Target: none; Foundry earns nothing, so it has no margin target.
- Lever: the coding-agent run cost per filled slot, which falls when slots are filled once and reused rather than re-filled.

## Because
- Foundry is free and has no price (advantage.model.pricing@5)
- The public tree holds no pricing, revenue or funding records (finding:foundry-public-repo-facts)

## Watch
- If slots re-filled although none of their pinned inputs changed > 0 in any month, then fix the step that re-ran.
