---
inspector: patch
---

`checkReviewEvidence` now accepts an optional `carriedApproval` option naming an earlier approved head a caller proved carries forward to the current one, and echoes it back on `ReviewEvidenceReport.carriedApproval` (and the rendered `verify-standards` report line) purely for visibility — it changes nothing about whether a change passes or fails review.
