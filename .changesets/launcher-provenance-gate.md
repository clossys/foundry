---
launcher: minor
---

`checkSetProvenance()` reports, for one change set, whether each package version it installs or updates is verified by the hub's pinned Integrator, with no exception for an unverified package, so an unattested first publication blocks; `plan`, `materialize` and `verify` do not run it yet.
