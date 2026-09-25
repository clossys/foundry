---
launcher: minor
---

New `bundleDigest()` computes the digest an approval binds: the canonical digest of the plan digest and, sorted by id, the id and change-set digest of each repository that has a change set, and nothing else (#1178).
