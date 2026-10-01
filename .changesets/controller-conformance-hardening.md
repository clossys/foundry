---
controller: patch
---

`site-conformance-check` now exits 2 instead of 1 when a source file or directory cannot be read, and for any unexpected failure. Import detection reads tokens in one linear pass, so long whitespace runs no longer take quadratic time and a commented-out, quoted or member-call import no longer satisfies `site/route-not-publisher-view`. A symlink under the app directory is the unwaivable finding `site/symlink-unscanned`. A `--site` or app directory reached through a symlink, a symlinked route manifest or waiver file, and a source file, or a `.ts` or `.tsx` file reached by a relative import, that is not valid UTF-8 are refused (#1820); a relative import of any other file type, such as an image, is skipped unread. The raw-colour string scan is also one linear pass.
