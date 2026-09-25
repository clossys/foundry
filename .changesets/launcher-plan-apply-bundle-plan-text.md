---
launcher: minor
---

`planApplyBundle()` throws, before computing anything, when a staffed role is not a lowercase id token (`role-not-an-id`) or a package act's `planItem` is not its repository id, a colon and its package name (`plan-item-not-derived`), so no plan text reaches a public ledger. A role that is not one path segment is no longer refused as `unsafe-path`; it is refused this way (#1178).
