---
inspector: minor
---

Review evidence on a merge-queue run: `ReviewEvidenceOptions` gains an optional `mergeGroup` (`{ headSha, containsHeadShaUnderTest }`, exported as `ReviewEvidenceMergeGroup`). When supplied, `headShaUnderTest` must name the queued pull request's own head, and the check is `indeterminate` with the new reason `merge-group-head-not-contained` unless the caller proved the group commit merges exactly that head. An unusable `mergeGroup` is `indeterminate` with the new reason `merge-group-unusable`. Runs without `mergeGroup` are unchanged.
