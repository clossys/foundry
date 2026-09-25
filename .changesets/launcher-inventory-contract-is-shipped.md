---
launcher: patch
---

Doc comments and README prose in `@clossys/launcher` said `docs/contracts/repository-inventory.json` "is not shipped in this package," which reads as though this package ships no copy of the contract at all. It now says that exact monorepo path does not ship, but this package's build packs and ships its own copy of the contract -- true of no other contract this package validates against, which really do not ship in any form (#1179).
