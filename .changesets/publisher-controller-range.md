---
publisher: patch
---

Tighten the `@clossys/controller` dependency range from `~0.9.0` to
`~0.9.14`. `@clossys/publisher/pack` imports `packStatusToLifecycle`,
`PACK_STATUSES`, `LIFECYCLE_CONDITIONS`, and `LIFECYCLE_STATES` from
`@clossys/controller`, which first exports them in 0.9.14. The old range
also admitted earlier 0.9.x releases without them, including the 0.9.10
release on the public registry, against which importing
`@clossys/publisher/pack` fails at module load. The README's "Requirements
and version coupling" section no longer restates the dependency ranges, so
a release cannot leave it stale, and now names the root-entry imports from
`@clossys/controller` alongside the `./policy` subpath.
