---
launcher: minor
---

`RepositoryObservation` has optional `pnpmWorkspaceText` and `npmrcText`, which `observeRepository()` fills with the exact text of the pnpm workspace file and of `.npmrc`, and the planner throws when either is not the file `files` digests. `observeRepository()` reports the `apply` phase only when the Starter pin is also in the range the setup templates support, so a repository pinned at `0.1.9` or `0.3.0` reads as `setup`, and a repository in its setup phase reports `.github`, `.starter` and, for pnpm, the workspace file it would create as roots its profile does not declare.
