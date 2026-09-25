---
advisor: minor
---

`validateAdvisorPlan()` accepts four optional plan fields from the shared plan contract -- `kits`, `staffing` (roles per repository, by repository inventory id), `packages` (exact `install` or `pin-starter` acts, each with a lowercase scoped name of at most 214 characters, one exact version with at most 16 digits in each part and no prerelease or build suffix, and one canonical `sha512-` integrity value) and `resolution` -- and an optional `subjectDigest` on a decision (#1178).
