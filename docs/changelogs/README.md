# Package changelogs

Each package's release notes live here, one file per package:
`docs/changelogs/<dir>.md`, where `<dir>` is the package's `packages/<dir>`
directory name. Each package README links to its file by absolute public URL,
`https://github.com/clossys/foundry/blob/main/docs/changelogs/<dir>.md`.

## Why here and not in the package

A changelog inside the package ships in its tarball. A published tarball can
never be corrected, so a wrong sentence there stays wrong for that version.
Editing the file also changes packed content, which needs a changeset and a
release, and it changes the `packages/<dir>` tree hash that qualification
records bind to. Kept here, a correction is an ordinary docs edit with no
changeset and no release.

## Format

[Keep a Changelog](https://keepachangelog.com), newest release first, under a
`# Changelog` title. The release PR writes each release as a
`## <version> - <YYYY-MM-DD>` section. Some older entries use the bracketed
`## [<version>] - <YYYY-MM-DD>` form, which is also accepted. If any consumed
changeset was `major`, the section starts with a `### Breaking changes`
subsection.

New sections are written by the release PR
(`node scripts/apply-release-changesets.mjs`) from the pending changesets in
`.changesets/`. Each changeset summary becomes one bullet. Do not add a
section for a new version by hand. See [docs/RELEASING.md](../RELEASING.md).

## Rules

- Start a new package's changelog fresh, at its real first version. Never
  copy one in from another repository; see [AGENTS.md](../../AGENTS.md).
- Never put a changelog in `packages/<dir>/` or in a package's `files`.
  `scripts/check-changelog-location.mjs` fails on either one. It also fails
  when this file lacks an entry for the manifest's current version, or the
  README lacks the link.
- This directory is public text. The public-safety and contamination gates
  scan it, the contamination gate as part of scanning `packages/<dir>`.
