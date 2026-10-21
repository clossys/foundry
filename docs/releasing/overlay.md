# Overlay prerelease

Every merge to `main` publishes packed builds of `@clossys/designer` and
`@clossys/publisher` to one rolling GitHub prerelease on this repository,
tagged `overlay`. A consumer can install and preview unpublished `main`
before a release reaches npm.

It is not a release. Nothing is published to npm or any other registry,
no version is bumped and no changeset is applied. The `version` inside each
tarball is the version currently on `main`, which is usually the last
published version. What is new on `main` is listed in the manifest's
`pendingChangesets` and shows up in its tree digests.

## What the prerelease holds

Each run of [`.github/workflows/overlay-prerelease.yml`](../../.github/workflows/overlay-prerelease.yml)
replaces the release's assets with exactly three files:

| Asset | What it is |
| --- | --- |
| `designer.tgz` | `npm pack --ignore-scripts` of `packages/designer` after `npm run build` |
| `publisher.tgz` | the same for `packages/publisher` |
| `overlay-manifest.json` | the digest manifest described below |

The tag moves to the merged commit on each run. An older run still in
progress when a newer merge lands is cancelled, so only the newest `main`
is ever published.

### Scanned before upload

The workflow runs in three jobs. `pack` installs, builds and packs with a
read-only token and no secret. `scan` installs and builds nothing: it
records the sha256 of all three files, then scans each tarball with
`scripts/check-artifact-safety.mjs --require-denylist --sha256 <recorded>`
and the manifest with `scripts/check-public-safety.mjs --require-denylist`.
Both run in FULL mode, with the identity denylist taken from the same
repository secret CI's required `artifact safety (tarball)` check uses.
Without that secret the run fails; it never falls back to a partial scan.
The denylist is never printed and is removed when the job ends.
`check-artifact-safety.mjs` passes a package marked `private` without
scanning it, so a `private` field set to anything but `false`, in
`packages/<dir>/package.json` or in the packed one, fails the run before
packing and again before the scan.

`publish` holds the write token and never sees the denylist. It uploads
nothing unless every file it downloaded has exactly the sha256 the scan job
recorded (`overlay-manifest.mjs verify --scanned`, which also refuses an
extra or missing file).

### Never moved backwards

Before `publish` moves the tag or touches any asset, `overlay-manifest.mjs
decide` checks two things:

- this run's commit is still the tip of `main`, and
- when a manifest is already published, this run's `committedAt` is not
  older than the published one and its commit is a descendant of the
  published commit (GitHub's compare status is `ahead`).

If either fails, the run changes nothing, ends successfully and records the
reason as a notice. Re-running an old workflow run therefore cannot put an
older `main` back on the release. Re-running the run for the current tip
uploads the same commit again. If any of the inputs cannot be read, the
step fails and nothing is changed.

## Manifest

`overlay-manifest.json` is written by `scripts/overlay-manifest.mjs`. Its
keys appear in the order below, and building it twice from the same commit
and tarballs gives the same bytes: no wall-clock time and no randomness go
into it.

| Field | Type | Meaning |
| --- | --- | --- |
| `schemaVersion` | number | `1` |
| `kind` | string | `"foundry-overlay-manifest"` |
| `treeDigestAlgorithm` | string | `"sha256-lines-v1"` (defined below) |
| `commit` | string | full 40-character lowercase sha of the `main` commit the tarballs were built from |
| `committedAt` | string | that commit's committer timestamp, ISO 8601 UTC to the second, for example `2026-01-31T12:00:00Z`. It comes from the commit, never from the build clock |
| `pendingChangesets` | string[] | sorted file names of the pending `.changesets/*.md` files at `commit` (`README.md` excluded) |
| `packages` | object | exactly two keys, `designer` and `publisher` |

Each `packages.<dir>` entry:

| Field | Type | Meaning |
| --- | --- | --- |
| `name` | string | the packed `package.json` name, for example `@clossys/designer` |
| `version` | string | the packed `package.json` version |
| `tarball` | string | the asset file name, `<dir>.tgz` |
| `integrity` | string | SRI integrity of the tarball bytes, `sha512-<base64>`, the same form npm writes into a lockfile |
| `tarballSha256` | string | lowercase hex sha256 of the tarball bytes |
| `tarballBytes` | number | tarball size in bytes |
| `treeDigest` | string | lowercase hex `sha256-lines-v1` digest of the unpacked `package/` tree |
| `files` | number | number of files in that tree |

A manifest missing either package, or with any field missing or malformed,
is rejected by `validateOverlayManifest` and by every command below. It is
never treated as a partial result.

### Tree digest (`sha256-lines-v1`)

For every regular file under the tarball's `package/` directory, take one
line: the file's sha256 in hex, two spaces, its path relative to
`package/`, and a newline. Sort the lines by path, byte order. `treeDigest` is the sha256 of those lines joined
together. File modes and mtimes are not included. A symlink or any other
non-regular entry makes the digest fail rather than be skipped.

The same value from a shell, inside an extracted `package/` directory:

```sh
find . -type f | sed 's|^\./||' | LC_ALL=C sort |
  while IFS= read -r f; do printf '%s  %s\n' "$(shasum -a 256 "$f" | cut -d' ' -f1)" "$f"; done |
  shasum -a 256
```

## Fetching and verifying

```sh
gh release download overlay --repo clossys/foundry --dir foundry-overlay --clobber
```

With a checkout of this repository, verify all three files in one step.
This checks each tarball's integrity, sha256, size, unpacked tree digest
and packed name and version against the manifest, and exits non-zero on
any mismatch:

```sh
node scripts/overlay-manifest.mjs verify --manifest foundry-overlay/overlay-manifest.json --dir foundry-overlay
```

Without a checkout, check a tarball's integrity directly:

```sh
printf 'sha512-%s\n' "$(openssl dgst -sha512 -binary foundry-overlay/designer.tgz | base64 | tr -d '\n')"
```

and compare the result with `packages.designer.integrity`.

If a download lands while a run is replacing assets, the manifest and a
tarball may come from different commits. Verification then fails. Download
again after the run finishes. Do not install a set that fails verification.

## Detecting a change

Decide whether `main` changed what you would install from
`pendingChangesets` and each package's `treeDigest`. Do not use `version`,
which stays the same until a release is applied, or `tarballSha256` and
`integrity`, which change with the compressor whenever the same content is
packed again. `overlayChangeKey()` and `overlayChanged()` in
`scripts/overlay-manifest.mjs` implement exactly that rule. Use `integrity`
to pin and check the bytes you downloaded.

## Limits

- Only `designer` and `publisher` are packed. A dependency of either on
  another `@clossys/*` package still resolves from npm at its published
  version.
- Older builds are not kept. The release always holds only the newest
  `main`.
- Re-running an old run while a newer one is in progress cancels the newer
  one (the two share a concurrency group). The old run then changes
  nothing, so the overlay stays at its previous commit until the next merge
  or until the newer run is re-run.
- The manifest records what was built. It is not a qualification record
  and does not stand in for the release path in
  [`docs/RELEASING.md`](../RELEASING.md).
