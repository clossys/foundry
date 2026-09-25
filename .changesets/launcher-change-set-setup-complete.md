---
launcher: minor
---

`validateRepositoryChangeSet()` refuses a setup set that lacks exactly one each of the caller workflow, Starter request, CI template and path-scope job, and one Starter pin, or that has a release-age exemption when its package manager is npm or none, or none when it is pnpm or Yarn (#1178).
