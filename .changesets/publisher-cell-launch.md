---
publisher: minor
---

Use the Publisher launch cell brief for pack review and move site identity validation and drift checking into Publisher.

Breaking (0.x): output strategy provenance now requires a brief contract, cell-version refs and fingerprint; legacy record provenance is rejected with a migration diagnostic. The site template reads Publisher site identity and the compiled launch brief without legacy file fallbacks. No exports are removed.
