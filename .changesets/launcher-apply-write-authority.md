---
launcher: minor
---

`launcher-apply-plan materialize` and `verify` now refuse, writing nothing, unless the plan committed at the hub's branch head approves a bundle that holds the change set, or the set is an apply set admitted under the one-approval rule; the ledger records the binding the hub decided.
