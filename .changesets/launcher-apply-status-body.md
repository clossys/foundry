---
launcher: minor
---

`launcher-apply-plan status` now compares the pull request's body with the change set's stored `bodySha256`: a pull request is `proposed` only when `sha256:` and the SHA-256 of its body's UTF-8 bytes, exactly as GitHub returned it, equal that hash, and is otherwise `diverged` (`body-mismatch`, also for a body that is not well-formed UTF-16). A change set with no `bodySha256` is `indeterminate` (`body-unbound`). The body is checked after the base branch, branch and title and before the head, only this set's own pull request is hashed, and neither hash nor body is printed (#1178).
