# Changesets

A pull request that changes a package's packed content adds a file here
instead of bumping the package's own `version` directly. A periodic or
on-demand release PR (`node scripts/apply-release-changesets.mjs`, wired as
`.github/workflows/release-pr.yml`) applies every pending changeset: it
bumps each named package once, writes its changelog entry (in
`docs/changelogs/<dir>.md`, never inside the package), regenerates
`package-lock.json`, and deletes the changesets it applied.

See issue #1255 for the design, and `scripts/collect-changesets.mjs`'s own
header for the exact file format.

## Format

`.changesets/<slug>.md`, filename matching `^[a-z0-9][a-z0-9-]*\.md$`:

```md
---
controller: minor
writer: patch
---

Add the shared lifecycle vocabulary consumed by check-package-framework.
```

- The frontmatter key is the `packages/<dir>` directory name, not the scoped
  npm package name.
- The bump level is one of `patch`, `minor`, `major`.
- Everything after the closing `---` is the summary. It becomes the
  changelog line for that package verbatim, so write it for a reader of
  the changelog, not for a reviewer of this pull request.

`scripts/check-release-readiness.mjs` accepts a pending changeset naming a
package as an alternative to bumping that package's version directly in the
same pull request.
