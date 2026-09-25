---
advisor: minor
---

`canonicalSnapshot()` returns a registry snapshot in its canonical order, packages sorted by name and each package's versions by version, and `resolvePackages()` reads a valid snapshot in that order, so every position a finding names is the same however a fetch listed the packages, and a re-fetch of the same selection gives byte-identical output (#1178).
