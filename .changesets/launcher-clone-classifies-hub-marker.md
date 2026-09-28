---
launcher: patch
---

When Launcher runs in an empty directory and clones an existing `{owner}/workspace` repository, it now classifies the clone's hub marker like a local run: a current marker resumes, a legacy `.clossys/` marker is migrated, both markers are refused, and a clone with no marker is appointed as the hub (#1585).
