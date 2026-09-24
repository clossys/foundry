---
publisher: patch
---

README: the "Lifecycle vocabulary" section now matches the source. A pack
item's `status` is one of `PACK_STATUSES` (`absent`, `found`, `draft`,
`in-review`, `kept`, `published`), which `packStatusToLifecycle` maps onto
the six shared `LIFECYCLE_STATES`; it is not one of the shared states
itself, and `validatePackManifest` reports a shared state such as
`approved` as `invalid-status`. The `pack` export list now names the real
re-exports from `@clossys/controller` (`PACK_STATUSES`,
`LIFECYCLE_STATES`, `packStatusToLifecycle`, and the `PackStatus`,
`LifecycleState`, and `PackStatusLifecyclePosition` types) instead of
`LIFECYCLE_STATUSES`, `isLifecycleStatus`, `isLifecycleCondition`, and
`LifecycleStatus`, which this package does not export.
