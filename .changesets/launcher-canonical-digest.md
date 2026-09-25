---
launcher: minor
---

New `canonicalDigest()` returns `sha256:` and the hex SHA-256 of any value's RFC 8785 canonical JSON; `planDigest()` now computes through it and gives the same digest for every plan as before (#1178).
