---
launcher: minor
---

Inventory documents are now validated against one shared contract, `docs/contracts/repository-inventory.json` (v1): `schemaVersion: 1`, a `repositories` array of `{ id, packages? }` entries, no other top-level or per-entry field. `id` must be a bare repository name or `owner/name` in the same format Launcher's own sibling/clone resolution already requires (no `.`, `..`, empty segment, whitespace, or more than one `/`), and two ids naming the same repository under a different letter case are a duplicate. `packages`, when present, must match `@clossys/integrator`'s `InventoryPackageEntry` (#996) exactly.

`--inventory <path>` is validated against that contract before it is written; a mismatch refuses before any file is touched, naming the offending field, and writes nothing (#1334).

Every read of the stored `clossys/.state/inventory.json` -- not only on appoint, but on every resume, including the sibling roster in the health report, and `--clone-missing` -- is validated the same way. Before this change, only a document that failed to parse as JSON at all was refused; a document that parsed but carried fields this contract does not recognize had its ids extracted and used anyway, with no warning that the document did not conform -- `--clone-missing` against such a document could `gh repo clone` a repository named only in that unrecognized-shaped entry. It now reports `invalid`, with the reason, in the health output, and `--clone-missing` clones nothing until the stored inventory is fixed.

An existing hub whose stored inventory carries fields beyond this contract's `id`/`packages` (for example a richer per-entry shape from before this contract existed) will now show as `invalid`, with the offending field named, instead of having its ids silently extracted and used with no warning.

`docs/contracts/repository-inventory.json` also names two fields a future v2 does not add yet: a per-entry `status` and a GitHub repository id distinct from the human-chosen `id` string, planned alongside the apply-plan work (#1178).
