---
advisor: minor
---

`renderAdvisorStatus()` adds one line to "Recommended next", after a blank one, when a plan declares `delegatedCopyApproval`: approving the plan also accepts delegate-approved copy on production, for every copy entry or only for the listed scopes (#1614). A plan without the field renders exactly as before. The renderer throws a `TypeError` naming the position, never the value, for a target other than `production`, an empty `scopes` list, or a scope outside the accepted copy entry-id namespace shape.
