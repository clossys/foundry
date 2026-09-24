---
customer: minor
---

The `foundry` manifest block now declares `outputs` (the seven
`clossys/customer/*.json` session records this role owns), `feeds` (the
`keep-verdict` at `clossys/customer/keep.json`, which Publisher waits for
before it seals), and `fit`, which names a new shipped `fit-signals.json`
with two signals: a named audience to speak as, and an audience-facing
candidate to keep or fail. `intake` and `status` are not declared yet. The
README now documents every exported type.
