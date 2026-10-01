---
controller: patch
---

`site-conformance-check` now exits 2 instead of 1 when a source file or directory cannot be read, and for any unexpected failure. Import detection reads tokens in one linear pass instead of a backtracking regular expression, so long whitespace runs no longer take quadratic time and a commented-out, quoted or member-call import no longer satisfies `site/route-not-publisher-view`. A symlink under the app directory is reported as the unwaivable finding `site/symlink-unscanned`, and a `--site` or app directory that is, or is reached through, a symlink, a symlinked route manifest or waiver file, or a source file that is not valid UTF-8 is refused (#1820). The raw-colour string scan is also a single linear pass, and a plain `from("x")` call no longer counts as an import.
