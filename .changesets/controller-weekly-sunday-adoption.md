---
controller: minor
---

Add the weekly Sunday `@clossys/*` adoption convention for consuming
repositories (owner direction 2026-09-23, #1187/#1259's cadence rule):
extends `conventions/documents/ci-conventions.md` with a fifth, orthogonal
section alongside the cost/speed/quality/security MECE four, covering one
grouped `@clossys/*` dependency-update pull request per repository per
week scheduled for Sunday, a security-advisory bypass, the no-other-day
rule, and the required `integrator-provenance-check` on the adoption PR.
Adds `evaluateWeeklyAdoption` (`./conventions/weekly-adoption.ts`), the
pure evaluator for those four rules, and wires it into
`evaluateCiConventions` via the new, opt-in
`CiConventionsDeclaration.weeklyAdoption` field. Does not apply to this
repository, which produces `@clossys/*` rather than consuming it.
