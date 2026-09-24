---
designer: minor
---

The `foundry` manifest block now declares `needs` and `solves` (package
framework, issue #1172). `needs` names Strategist's `brand-derivation`,
which the brand overlay binds to token slots. `solves` claims the
`designer-interface-quality` problem, measured by the design conformance
rate, backed by `token-purity` and shown by the `token-purity-violated`
case. Its evidence is `designed`: no retained qualification record covers
this version yet.

Minor, not patch: these are new declared manifest fields that discovery and
the Advisor catalogue read. Nothing that already existed changes shape.
