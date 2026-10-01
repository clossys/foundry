---
launcher: minor
---

`planApplyBundle()` skips a repository as `indeterminate`, outside the bundle digest, for a package manager other than npm or pnpm (`package-manager-unsupported`), a plan with no single Starter pin there (`starter-pin-absent`), a pin outside `STARTER_PIN_RANGE` (`starter-pin-unsupported`), a pnpm release-age file whose text is not supplied (`release-age-text-absent`) and a Starter request that cannot be rendered (`starter-request-invalid`), and it skips an apply set whose Starter pin would write a key (`starter-request-stale`).
