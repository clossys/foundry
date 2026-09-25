---
launcher: minor
---

`validateRepositoryChangeSet()` gives every act a write kind and checks each whole file against it in one rule (C15): no act deletes a file; a discovery link is only created or kept; a release-age exemption file is created or changed, never left as it was; and a Controller profile edit changes a file the default branch has, never creating or deleting it (#1178).
