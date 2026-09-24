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

## Style

One factual sentence per change, in consumer terms: what a user can now do,
or what now behaves differently. No absolute qualifier ("exactly", "never",
"always", "independently", "append-only", "fully", "guaranteed", ...) unless
a test proves it. Don't describe what did NOT change — say what the change
actually does (issue #1423).

Most false claims found in this repository's own release text so far were
not made-up facts; they were characterizations layered on top of a true
change — an absolute adjective the code never actually enforced, or a
sentence describing an absence rather than the behavior. Two of each,
generalized from real corrections made to this repository's own release
text:

**Good:**

- "A caller can now pass a second, optional argument to opt into the new
  behavior."
- "Each output is now a single record that the checker validates."

**Bad:**

- "Each output is now an append-only, independently observed record." — two
  unproven absolutes (`append-only`, `independently`); the checker
  validates one record, it doesn't check whether anything ever appended to
  it or observed it independently of anything else.
- "No schema or field change — prose only." — describes an absence instead
  of stating what changed, and the absence turned out to be false: the
  shipped text did change, and a caller-supplied copy is now refused unless
  it matches exactly.

`scripts/check-changeset-style.mjs` (`npm run check:changeset-style`) is a
**report-only** lint over this: it flags an absolute qualifier from a
configurable list, an entry past a length threshold (likely several
sentences bundled into one changeset), and negative-change phrasing. It
never fails a check or blocks a merge — see the script's own header for its
exit contract — it only prints what is worth a second look before a release
PR turns the summary into a `CHANGELOG.md` line verbatim.
