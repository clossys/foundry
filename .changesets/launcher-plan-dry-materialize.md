---
launcher: minor
---

`launcher-apply-plan plan` now dry-materializes each repository whose set changes a lockfile in a temporary directory, so its sheet reports V6 (lockfile regeneration) and V9 (package provenance) instead of `lockfile-not-run`, without writing the clone (#1178).
