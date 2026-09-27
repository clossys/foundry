---
starter: patch
---

Make the protected-base `advisor` request block optional. When it is omitted, `decide` verifies matching `authorization.planDigest` and ledger plan digest values instead of running `@clossys/advisor`, while the target check still runs.
