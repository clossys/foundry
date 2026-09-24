---
starter: minor
---

Add `foundry-starter prove-head`, which proves a pull request's own npm install from the protected base's installed Starter without executing any pull-request code.
It reads the pull-request head's request, `package.json`, and `package-lock.json` as bounded data from a checkout whose `.git/HEAD` must equal the trusted `workflow_run` head commit.
It refuses every lockfile entry that is not a single-SHA-512 tarball from `https://registry.npmjs.org/`, and it reports workspaces, pnpm, and older lockfile versions as indeterminate.
It stages only the manifest's dependency fields and the lockfile into a fresh directory, then runs `npm ci --ignore-scripts` there under a literal environment with no token, empty npmrc files, and the public registry.
It checks the head request's exact Starter, Advisor, and target identities from installed manifests and the lockfile, and writes a separate `HeadInstallReport` with the same `0`/`1`/`2` exit codes and a `changedFromBase` list.
Add `evaluateHeadInstall()` and the `HeadInstall*` types to the root export, and `PUBLIC_NPM_REGISTRY`, `validateNpmLockfileSources()`, and `stagedNpmManifest()` to `@clossys/starter/npm`.
Document the one-merge lag of `decide` in `documents/caller-workflow.md` and the README, and add an optional `prove-head-install` job to the npm caller template.
`decide`, its report, and the existing caller templates are unchanged.
