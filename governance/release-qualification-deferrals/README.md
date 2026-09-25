# Release qualification deferrals

Schema version: `1`

Acknowledged, issue-referenced exceptions to
`scripts/check-qualification-record-required.mjs` (issue #863): a package
version that merged to `main` ahead of its retained qualification record,
with a reason and a tracking issue. Modelled on the `gaps` mechanism in
`docs/contracts/package-evidence.json` / `scripts/check-package-evidence.mjs`.
This is a countdown, not a standing exemption — the gate refuses to let an
entry outlive its reason: once a retained, matching record exists for the
exact package@version an entry names, the entry is stale and the gate fails
until it is removed and its issue closed.

## Layout (issue #1254)

One file per acknowledged deferral, named `<package>@<version>.json`, for
example `governance/release-qualification-deferrals/controller@0.9.8.json`.
`<package>` is the directory name under `packages/` (not the scoped npm
name), matching every other script here that joins a deferral against a
manifest.

Before this migration, every deferral lived as one entry in a single shared
array at `governance/release-qualification-deferrals.json`. Two unrelated
pull requests each acknowledging a deferral for a different package —
usually because neither could reach the pinned release runtime
(`scripts/lib/release-runtime.mjs`) — both had to append to that same file,
so otherwise-unrelated changes collided on the same lines and conflicted on
merge (issue #1187, item 3). Splitting the store into one file per
package@version removes that shared line range: two pull requests adding
deferrals for different package@version pairs now touch disjoint files.

Each entry file carries only:

```json
{
  "package": "controller",
  "version": "0.9.8",
  "reason": "…",
  "issue": 948
}
```

The schema version and this explanation, which describe the store as a
whole rather than any single entry, live once, here, instead of being
repeated at the top of every file the way the old single-array file's
`schemaVersion` and `$comment` fields were.

## Removing a satisfied deferral

`scripts/remove-qualification-deferral.mjs --package <key> --version <version>`
deletes the one file naming that package@version, if any — see that
script's own header. `.github/workflows/qualify-candidate.yml` runs it
automatically in the same run that retains a qualification record.
