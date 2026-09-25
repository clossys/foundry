---
advisor: minor
---

The Advisor skill says what to do for each `advisor-resolve-packages` outcome by rule: take a fresh snapshot for an unusable or undecided one, fix the plan for a plan-level refusal, and record an `unavailable-environment` blocker for a package that is not ready. It skips package resolution for a plan with no staffing or when no snapshot step is available, and clears stale `packages` and `resolution` before resolving again after a staffing change (#1178).
