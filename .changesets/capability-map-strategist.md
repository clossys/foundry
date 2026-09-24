---
strategist: minor
---

The `foundry` manifest block now declares `capabilities` (manifest schema
version 3, #1196), a capability map of this role's craft with fourteen
capabilities. Each `built` or `partial` capability names its own
release-qualification case as `proofCase`, run through
`strategist-check` (#1272). Seven are `built`: the evidence base
(`facts-clean`), audience understanding, market definition, positioning,
brand derivation, the roadmap, and constraints. Three are `partial`:
claims, because an approved claim still validates with no fact reference;
direction currency, because `strategist-check direction` still reports a
coverage gap for a superseded entity that no current artifact reviews; and
the strategy brief, because `strategist-check handoff` checks readiness
but no command writes the projected contract. Four are `planned`, with no
proof case: mission and values (`readStrategy` reads and validates
`mission.json`, but no command checks it), the business model and pricing
hypothesis, the north-star metric tree (#533), and the competitive
landscape (#1268).
