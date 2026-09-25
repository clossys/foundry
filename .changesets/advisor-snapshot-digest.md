---
advisor: minor
---

`snapshotDigest()` is a registry snapshot's canonical digest: `sha256:` and the SHA-256 of the RFC 8785 canonical JSON of `snapshotDigestSubject()`, the registry and each package's name, status, `latest` and versions, sorted. It leaves out when and by what the snapshot was fetched and the hash of each raw registry response, so fetching the same selection again gives the same digest, and it throws for a snapshot that does not validate (#1178).
