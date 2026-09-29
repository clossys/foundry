---
launcher: minor
---

observeRepository() turns one local clone into a RepositoryObservation read only from the default-branch head's git objects, or into a skipped observation with a reason id. A clone that is missing, has another origin, uncommitted or untracked changes, a hidden edit, a submodule, an alternate object store, a local head that differs from the remote tip, or a .git/config key a plain clone does not carry is refused rather than observed, and no configuration, filter or submodule in it is run.
