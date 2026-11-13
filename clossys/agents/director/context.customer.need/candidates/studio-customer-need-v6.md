---
slot: "context.customer.need"
source: {"kind": "derived", "ref": ["finding:owner-foundry-director-2026-11-11", "finding:foundry-public-repo-facts"]}
feeds: []
functions: ["product"]
note: "Option A (recommended): the project's need, for people building with coding agents."
---

## Direction
- Job: run brand, copy and site work through coding agents and get a consistent result each time, with every piece traceable to one brief.
- Pain: one-prompt-at-a-time agents drift between runs and keep no record of why a page looks or reads the way it does.
- Trigger: a second site or product needs the same design and copy decisions again.
- People keep the creative calls; only the production moves to the agents.

## Because
- The owner split the open-source part out as the Foundry project, with its own Director content (finding:owner-foundry-director-2026-11-11)
- Foundry ships four agents whose gates check what is on disk, never a manifest claim (finding:foundry-public-repo-facts)

## Watch
- If public issues asking for a one-off page generator rather than a repeatable chain > 3 in any quarter, then review this need with the owner.
