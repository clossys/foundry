---
slot: "identity.naming.architecture"
source: {"kind": "derived", "ref": ["finding:foundry-public-repo-facts", "finding:foundry-public-naming", "finding:foundry-public-agent-naming", "identity.naming.name@3"]}
feeds: []
functions: ["brand"]
note: "Agent pick for the Foundry open-source project Director (R2F-L2 public scrub, 2026-11-12): same Direction as v5, re-cited to public findings only."
---

## Direction
- Model: branded house. Clossys is the master brand; Clossys Foundry is this open-source engine and Clossys Studio is the app built on it.
- Rule: name products "Clossys" plus a plain descriptive noun; agents keep plain role names (Director, Designer, Writer, Publisher) with no Clossys prefix, and Studio agent routes stay flat.
- Example: Clossys Studio → /designer → Designer.

## Because
- The packages publish under the @clossys scope (finding:foundry-public-repo-facts)
- The public Studio requirements name the app Clossys Studio (finding:foundry-public-naming)
- The public Studio requirements give flat agent routes (finding:foundry-public-agent-naming)
- The project name is Clossys Foundry (identity.naming.name@3)

## Watch
- If product names without the Clossys master brand, or agent names with a Clossys prefix, found in public pages at release review > 0 in any month, then return them to Writer.
