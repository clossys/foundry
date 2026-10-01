---
writer: minor
---

`CopyResolveOptions` accepts `approvalPlan`, the bytes of an Advisor plan record: a delegate-approved entry then resolves on `production` when that plan validates, declares `delegatedCopyApproval` covering the entry, and its latest decision approves the plan's own digest (#1586).
