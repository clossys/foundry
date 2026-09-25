---
launcher: minor
---

New `changeSetDigest()`, `changeSetDigestSubject()`, `CHANGE_SET_DIGEST_EXCLUDED_FIELDS` and `DERIVED_FILE_DIGEST_FIELDS` compute a repository change set's digest, which leaves out `changeSetDigest`, `branch`, `bundle`, `pullRequest`, `inverse` and `tooling`, and reduces each derived file to its `path`, `mode`, `derived`, `item` and `invariants` (#1178).
