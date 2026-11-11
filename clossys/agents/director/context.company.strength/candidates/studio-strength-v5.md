---
slot: "context.company.strength"
source: {"kind": "derived", "ref": ["finding:foundry-public-repo-facts", "finding:foundry-owner-answers-2026-11-03"]}
feeds: []
functions: ["product"]
note: "Agent pick for the Foundry open-source project Director (C6-FDIR fix round 1, 2026-11-11): re-drafted after the critic's reading; cites the recommended project core options; re-cite when the owner picks."
---

## Direction
- Edge: checks that read what is actually on disk or installed, never what a manifest claims about itself, across direction, design, copy and publishing.
- Evidence: the README thesis states it, and each agent package ships its own gates.
- Rarity: the gates are public and MIT, so anyone can copy them; the hard part to copy is keeping them green across four agents on every release. This claims the practice, not uniqueness (planner default).

## Because
- The README thesis and per-package gates are in the public tree, which is MIT licensed (finding:foundry-public-repo-facts)
- Claiming the practice rather than uniqueness is a planner default recorded with the owner answers (finding:foundry-owner-answers-2026-11-03)

## Watch
- If gates found passing on a manifest claim rather than on disk state > 0 in any month, then withdraw this Edge until the gate is fixed.
