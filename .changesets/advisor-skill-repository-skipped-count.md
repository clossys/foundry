---
advisor: patch
---

The `clossys-advisor` skill tells the client, when the card or an otherwise-empty result carries a `skippedCount`, that count of listed repositories was left off because their id did not fit the naming rule (never which ones); when every listed repository was skipped this way, it says so distinctly from an empty list -- none of the listed repositories had a usable id -- rather than reusing the "GitHub listed no repositories" wording for a list that was not actually empty (#1179).
