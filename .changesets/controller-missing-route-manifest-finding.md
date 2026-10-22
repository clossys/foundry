---
controller: patch
---

`site-conformance-check` now reports a missing `web-route-manifest.json` as the finding `site/manifest-missing` and finishes the scan with exit code 0, where it previously stopped with exit code 2.
