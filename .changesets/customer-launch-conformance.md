---
customer: minor
---

The `foundry` manifest block now declares `outputs` (the seven
`clossys/customer/*.json` session records this role owns), `feeds` (the
`keep-verdict` at `clossys/customer/keep.json`, which Publisher waits for
before it seals), and `fit` (a new shipped `fit-signals.json`: a named
audience to speak as, and an audience-facing candidate to keep or fail).
Every capability in the map now cites a qualification case that actually
runs its own intent through `customer-check`: `feedback-satisfied`,
`compare-satisfied`, `refer-satisfied`, `churn-satisfied`,
`adopt-satisfied`, and `worth-satisfied`, alongside the existing
`keep-satisfied`. Feedback, compare, and refer also have a violated
control case that fails on that intent's own rule. `intake`, `status`,
`needs`, and `solves` are not declared yet. The README now documents every
exported type.

Minor, not patch: these are new declared manifest fields and a new shipped
file that discovery reads. Nothing that already existed changes shape.
