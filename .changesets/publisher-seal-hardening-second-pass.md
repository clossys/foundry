---
publisher: patch
---

`publisher-seal` and `sealWebsite` refuse a production URL that carries a username or password. A seal interrupted between the ledger write and the manifest write is finished by running the same command again, which writes only the manifest from the identical ledger entry. The seal lock is taken in the real directory of each file, so two spellings of one directory contend, and only an existing lock is reported as another run holding it. `checkSealEvidence` requires `itemId`, and the `isSealInstant` export is removed.
