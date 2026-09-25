---
advisor: minor
---

Contract messages name an undeclared or repeated field by its position, never by its text, because a key is document text and can carry instructions written for the agent reading the message (#1178). `validateAdvisorPlan()`, `validateEngagementBrief()`, `validateRegistrySnapshot()`, `packageRequest()` and `resolvePackages()`, and the `advisor-render-status`, `advisor-package-request` and `advisor-resolve-packages` bins, report a field the contract does not declare at the object that holds it, as "has a field the contract does not declare (key 3 of this object)". `advisor-render-status` reports a repeated key as "repeats a key (key 2 of the object at position 57)", or "of the top-level object"; `advisor-package-request` and `advisor-resolve-packages` say only that the file repeats a key in one object.
