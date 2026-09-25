---
advisor: minor
---

New `planDigest()`, `canonicalJson()` and `PLAN_DIGEST_EXCLUDED_FIELDS` compute the canonical plan digest defined in `docs/contracts/advisor-plan-digest.md`: SHA-256 over the RFC 8785 canonical JSON of a valid plan without `asOf` and `decisions` (#1475).
