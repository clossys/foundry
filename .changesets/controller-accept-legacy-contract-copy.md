---
controller: patch
---

Implementation note: a caller's exact copy of a previously shipped
role-loop-archetypes.json or installed-position-contract.json keeps
validating, reporting a non-failing `legacy-contract-copy` advisory naming
the matched version. The recognized historical canonical contracts ship
as real, byte-identical files under
`packages/controller/contracts/historical/<version>/` -- currently only
0.9.10's `role-loop-archetypes.json` and `installed-position-contract.json`,
captured verbatim from that published version via
`git show 62d9dc570c0af76cd89e49bc40002fb5b36da2ca:packages/controller/contracts/<name>`
-- rather than a digest or a loosened comparison. `canonical.ts` exposes
them through `readHistoricalRoleLoopContracts()` and
`readHistoricalInstalledPositionContracts()`, each entry paired with the
controller version it shipped in; `index.ts` matches a caller-supplied
contract against that table with the same deep-equality `canonical()`
helper already used for the current shipped snapshot, never a partial or
key-subset match. Extend the table -- never replace or remove an entry --
the next time either contract's content changes. Refs: #1394.
