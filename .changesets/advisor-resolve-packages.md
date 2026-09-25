---
advisor: minor
---

`resolvePackages()` turns a staffed plan and a registry snapshot into the plan's exact `packages` (one `pin-starter` act per staffed repository and one `install` act per staffed role, each at the version the registry's `latest` named, with its `sha512-` integrity value), its `resolution.snapshotDigest`, and the `permittedPackages` a sponsor's grant permits. It refuses a snapshot from another registry and a package that is missing, unpublished, has no usable `latest`, or whose `latest` is a prerelease, deprecated, has no single `sha512-` integrity value in canonical base64, or is served from another host; a version with no attestations yet is a warning. The same inputs always give byte-identical output, and it makes no network call (#1178).
