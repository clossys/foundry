---
launcher: minor
---

`validateRepositoryChangeSet()` ties each discovery link (only for a role whose skill the set writes), the composed-skill manifest, the `AGENTS.md` and `CLAUDE.md` records (by path; their bytes are not checked here) and each setup template act to exactly the files it writes, requires mode `120000` exactly for a discovery link and the link's content to be its target, and lets a release-age exemption write at most its own file (#1178).
