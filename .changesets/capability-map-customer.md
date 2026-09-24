---
customer: minor
---

The `foundry` manifest block now declares `capabilities` (manifest schema
version 3, #1196), a capability map of this role's craft: seven
capabilities, all `built`, one per existing inhabit intent (`keep-verdict`,
`lived-feedback`, `comparison-against-alternatives`, `refer`, `churn`,
`adopt`, and `worth`), each an append-only, independently observed,
first-person record. Each capability names as its `proofCase` a
release-qualification case that runs that intent through `customer-check`
(`keep-satisfied`, `feedback-satisfied`, `compare-satisfied`,
`refer-satisfied`, `churn-satisfied`, `adopt-satisfied`, and
`worth-satisfied`), rather than one case standing in for all seven (#1272).
