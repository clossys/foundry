---
publisher: minor
---

`publisher-site-instantiate --root <repo> --pins <file.json>` copies the site template into the repository's `apps/site` with exact `@clossys/*` pins and adds `apps/*` to the root workspaces, refusing a non-empty target, a missing or non-exact pin, an unsafe root manifest and a template that holds a symlink before writing anything.
