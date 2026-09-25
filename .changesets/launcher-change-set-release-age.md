---
launcher: minor
---

`validateRepositoryChangeSet()` refuses a release-age exemption whose file is not its surface's (`pnpm-workspace.yaml` or `.yarnrc.yml`), whose surface the repository's package manager does not read, or whose scope is not the publishing scope this package was built with; `.npmrc` is no longer an exemption surface, because npm has no exemption key (#1178).
