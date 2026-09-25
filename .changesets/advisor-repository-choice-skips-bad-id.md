---
advisor: minor
---

`repositoryChoiceCard()` leaves a listed entry off the card, and counts it in the new `skippedCount`, when its `nameWithOwner` breaks the repository id rule -- for example an owner name GitHub itself lists but this contract's narrower id rule does not accept, such as one with an underscore -- rather than refusing the whole list over one bad id. `skippedCount` is present on the card, or on an otherwise-empty result, only when at least one entry was skipped, and never says which ones. A listing that is not even the right shape (a missing field, an unknown field, or a `nameWithOwner` that is not a string) still refuses the whole list, since that is a malformed file, not one bad id (#1179).
