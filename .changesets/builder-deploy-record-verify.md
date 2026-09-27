---
builder: minor
---

Adds deploy record types and `verifyDeployRecord` on `@clossys/builder/deployment` (issues #1518 and #360): a caller declares production branch, preview branches, preview URL, protection mode, and required environment names per target, then compares that record to a provider observation that carries names and settings only. The verifier fails closed on branch, preview URL, environment target, scope, classification, and protection drift, rejects the unsafe release-ref pairing when main is deploy-enabled while production is not the release branch, and reports indeterminate when an observation includes a secret value field.
