---
advisor: minor
---

`repositoryChoiceCard()` no longer refuses the whole list when one entry's `nameWithOwner` breaks the repository id rule (for example an owner GitHub itself lists but this contract's narrower id rule does not accept, such as one with an underscore): it leaves that entry off the card and reports how many were skipped as `skippedCount`, on the card or on an otherwise-empty result. A listing that is not even the right shape (a missing field, an unknown field, or a `nameWithOwner` that is not a string) still refuses the whole list, since that is a malformed file, not one bad id (#1179).
