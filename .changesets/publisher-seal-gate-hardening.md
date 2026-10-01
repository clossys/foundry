---
publisher: minor
---

`publisher-seal` now refuses a symbolic-linked or hard-linked manifest or ledger, keeps each file's permissions, locks both files and refuses if either changed while it ran, restores the ledger when the manifest write fails, and takes its time from the clock instead of a `--now` flag, and the seal evidence now carries the `itemId` it was taken for, only the `website` item can be sealed, and `observedAt` must be a real calendar date.
