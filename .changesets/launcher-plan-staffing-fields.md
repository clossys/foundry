---
launcher: minor
---

`validateAdvisorPlan()` accepts four optional plan fields from the shared plan contract -- `kits`, `staffing` (roles per repository, by repository inventory id), `packages` (exact `install` or `pin-starter` acts, each with one exact version that has no prerelease or build suffix and one `sha512-` integrity value) and `resolution` -- and an optional `subjectDigest` on a decision (#1178).
