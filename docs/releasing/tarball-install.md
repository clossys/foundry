# Installing unreleased tarballs

A consumer can try a build from the default branch before it is released by
installing packed tarballs instead of registry versions. This page is the
recipe, and `scripts/tarball-install-check.mjs` is the check that proves it.

## Why an override is needed

First-party packages depend on each other with 0.x caret ranges, for example
`"@clossys/designer": "^0.12.0"` in publisher. In 0.x a caret locks the
minor: `^0.12.0` means `>=0.12.0 <0.13.0`. Once a build has moved past that
minor, the tarball no longer satisfies the sibling's range, and the package
manager installs a second copy of the sibling from the registry (or fails
when it cannot reach one). Two copies of a first-party package in one tree
can leave the consumer running code that is not under test.

The published ranges stay as they are. The consumer forces one copy of each
first-party package with an overrides block that points every first-party
name at its tarball.

## Pack

From a checkout of this repository, pack every first-party package the
consumer needs, including the ones the requested packages depend on. For
publisher that is designer, writer and controller as well:

```bash
npm ci && npm run build
mkdir -p ../tarballs
for dir in designer publisher writer controller; do
  (cd "packages/$dir" && npm pack --pack-destination ../../../tarballs)
done
```

The file names below are examples; use the names `npm pack` prints.

## npm

In the consumer's `package.json`, depend on the requested packages by tarball
path and list every packed package under `overrides`, with the same spec:

```json
{
  "dependencies": {
    "@clossys/designer": "file:../tarballs/clossys-designer-0.13.0.tgz",
    "@clossys/publisher": "file:../tarballs/clossys-publisher-0.14.0.tgz"
  },
  "overrides": {
    "@clossys/designer": "file:../tarballs/clossys-designer-0.13.0.tgz",
    "@clossys/publisher": "file:../tarballs/clossys-publisher-0.14.0.tgz",
    "@clossys/writer": "file:../tarballs/clossys-writer-0.7.0.tgz",
    "@clossys/controller": "file:../tarballs/clossys-controller-0.11.0.tgz"
  }
}
```

npm requires an override for a direct dependency to match that dependency's
spec (the same string, or a `$@clossys/designer` reference to it). Then run
`npm install`, confirm with `npm ls @clossys/designer` (and each other name)
that only one version is listed, and check that its `package-lock.json` entry
resolves to the tarball path.

## pnpm

pnpm reads the same mapping from `pnpm.overrides` in `package.json`:

```json
{
  "pnpm": {
    "overrides": {
      "@clossys/designer": "file:../tarballs/clossys-designer-0.13.0.tgz",
      "@clossys/writer": "file:../tarballs/clossys-writer-0.7.0.tgz",
      "@clossys/controller": "file:../tarballs/clossys-controller-0.11.0.tgz"
    }
  }
}
```

In a pnpm workspace, put the same map under `overrides:` in
`pnpm-workspace.yaml` so it applies to every project in that workspace. Confirm
with `pnpm why @clossys/designer`.

## Same-version caveat

Between releases, the default branch carries the version string that is
already on the registry: a tarball packed today can say `0.12.0` while the
registry also has a different `0.12.0`. Name and version alone cannot tell the
two apart. Only the lockfile entry's `resolved` path and `integrity` hash do.

- Keep the tarball's `resolved` path and `integrity` in the lockfile, and check
  them after every install. An entry that resolves to a registry URL is the
  registry copy.
- Re-packing produces a new integrity hash. Re-run the install after
  re-packing so the lockfile records the new tarball.
- A cache or a later install without the overrides block can bring back the
  registry copy of the same version. Keep the overrides in place for as long as
  the tarballs are in use.

## The check

```bash
node scripts/tarball-install-check.mjs                 # one minor past the current versions
node scripts/tarball-install-check.mjs --as-packed     # the same-version case
```

It packs designer and publisher plus any first-party packages they depend on
into a temporary directory, installs them into an empty project with the
overrides block above, and verifies that each first-party package resolves
once, at the top level, from its tarball, with the tarball's integrity.
By default it raises each packed version to the next minor in the temporary
copy only, which is the case a default-branch build is in once it moves past a
sibling's pinned minor.

The install is offline: an empty private cache, a sanitized environment with
no inherited npm configuration or credentials, no install scripts, and peer
dependencies left to the consumer. A request for a registry copy therefore
fails with `ENOTCACHED` and is reported as a finding instead of being
downloaded. `--no-overrides` and `--omit-override <name>` show that failure;
an `--omit-override` name must be one of the packed package names, or the
check does not run. `--keep` leaves the temporary directory in place and
prints its path. Exit codes follow the repository's gate convention: `0`
clean, `1` findings, `2` could not run.
