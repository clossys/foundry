---
launcher: minor
---

`verifyReleaseAgeExemption()` confirms that an edited release-age exemption file differs from the original by that one entry. It returns false for an unchanged file and for a pnpm `.npmrc` that conflicts or has a line outside the fixed safe shape.
