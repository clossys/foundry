---
slot: "identity.naming.architecture"
source: {"kind":"derived","ref":["https://github.com/clossys/foundry/issues/2553","clossys/agents/director/findings/foundry-public-agent-naming.md","finding:foundry-owner-answers-2026-11-03"]}
feeds: []
functions: []
note: "Unpinned naming-architecture draft from retained public owner requirements, updated 2026-11-01T02:20:53Z, and the owner answer of 2026-11-03."
---

## Direction
- Model: Branded house. Clossys is the master brand, and each product name describes what the thing is: Clossys Foundry for the engine and Clossys Studio for the app.
- Rule: Name products "Clossys" plus a plain descriptive noun. Agents keep plain role names (Director, Designer, Writer, Publisher) with no Clossys prefix, and Studio agent routes stay flat.
- Example: Clossys Studio → /designer → Designer.

## Because
- The owner set a branded house on 2026-11-03: Clossys as master brand, Clossys Foundry for the engine, Clossys Studio for the app, and plain role names for the agents (finding:foundry-owner-answers-2026-11-03).
- Retained public owner #2553, updated 2026-11-01T02:20:53Z: L9 supplies Clossys Studio; L10 supplies /designer → Designer without grouping; R3 requires flat routes.

## Watch
- If a product name without the Clossys master brand, or an agent name with a Clossys prefix, appears > 0 times in any Writer naming check, then return it to Writer against this rule.
- NEED: F7 drafts remain pending T4 clearance and are not an approved source for this draft.
- This candidate is unpinned. It supplies no LIVE claim or approval for downstream use.
