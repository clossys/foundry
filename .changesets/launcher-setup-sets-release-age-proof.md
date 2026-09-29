---
launcher: minor
---

`materializeRepository()` and `verifyRepository()` refuse, as `content-mismatch`, a release-age exemption file that is not the base commit's bytes plus one scope entry, as `verifyReleaseAgeExemption()` judges them over the base's `.npmrc`.
