---
launcher: minor
---

A registry snapshot records, for each package the registry has, only the version its `latest` dist-tag names and, when the registry lists that version, that one version's integrity, tarball, deprecation, publish time and attestation presence, plus the SHA-256 of the response it came from. It is validated against the shared registry snapshot contract before it is written, and the same registry answers produce the same bytes apart from `fetchedAt` (#1178).
