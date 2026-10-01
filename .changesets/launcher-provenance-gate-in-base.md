---
launcher: patch
---

The provenance gate (V9) now skips an `install` or `pin-starter` item only when its `satisfiedInBase` is exactly `true`; a missing, `null`, numeric or string value is gated like `false` instead of counting as already in the base (#1647).
