---
launcher: minor
---

Contract messages name an undeclared or repeated field by its position, never by its text, because a key is document text and can carry instructions written for the agent reading the message (#1178). `validateAdvisorPlan()`, `validateEngagementBrief()`, `validateRepositoryChangeSet()`, `validateApplyBundle()` and `launcher-apply-plan` report a field the contract does not declare at the object that holds it, as "has a field the contract does not declare (key 3 of this object)", and `launcher-apply-plan` reports a repeated key in a plan or brief file as "repeats a key (key 2 of the object at position 57)", or "of the top-level object".
