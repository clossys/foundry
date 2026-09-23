---
strategist: minor
---

Manifest framework fields (issue #1172). The `foundry` block now declares
`outputs`: the eleven `clossys/strategist/` records this role owns.
`feeds` lists the seven handoffs other roles consume: audiences,
positioning, claims, constraints, brand derivations, direction, and the
strategy brief. `fit` points at a new shipped file, `fit-signals.json`, with
one consumer-answer signal. `needs`, `solves`, `intake` and `status` are
not declared yet.

Per-capability proof cases (issue #1272). The retained qualification adapter
gains twelve cases across `strategist-check handoff`, `brand-coverage`,
`direction` and `apply`, each with its own fixture. Every capability that
cited `facts-clean` only as a placeholder now cites a case that exercises
it: audience understanding, market definition, positioning, brand
derivation, roadmap, and constraints stay `built`. Four capabilities move
to `partial`:

- `claims`: an approved claim still validates with no fact reference.
- `direction-currency`: `strategist-check direction` still reports a
  coverage gap for a superseded entity that no current artifact reviews.
- `strategy-brief`: `handoff` checks readiness, but no command writes the
  projected contract.
- `mission-and-values`: no command checks `mission.json`, so it keeps the
  disclosed `facts-clean` anchor.
