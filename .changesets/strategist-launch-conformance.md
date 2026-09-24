---
strategist: minor
---

Manifest framework fields (issue #1172). The `foundry` block now declares
`outputs`: the eleven `clossys/strategist/` records this role owns.
`feeds` lists the seven handoffs other roles consume: audiences,
positioning, claims, constraints, brand derivations, direction, and the
strategy brief. `fit` points at a new shipped file, `fit-signals.json`, with
one consumer-answer signal. `intake` and `status` are not
declared yet.

Per-capability proof cases (issue #1272). The retained qualification adapter
gains twelve cases across `strategist-check handoff`, `brand-coverage`,
`direction` and `apply`, each with its own fixture. No capability cites
`facts-clean` as a placeholder any more. `evidence-base` keeps it as its own
genuine case. Audience understanding, market definition, positioning, brand
derivation, roadmap, and constraints now cite a case that exercises them,
and stay `built`. Three capabilities cite their own case but move to
`partial`:

- `claims`: an approved claim still validates with no fact reference.
- `direction-currency`: `strategist-check direction` still reports a
  coverage gap for a superseded entity that no current artifact reviews.
- `strategy-brief`: `handoff` checks readiness, but no command writes the
  projected contract.

`mission-and-values` moves to `planned` with no proof case. `readStrategy`
reads and validates `mission.json`, but no command checks it, so no
qualification case can exercise it yet.
