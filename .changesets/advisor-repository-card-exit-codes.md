---
advisor: minor
---

`advisor-repository-card` exits `0` for a card or an accepted choice, `1` when the repository list given is empty, no listed repository has a usable id, or the choice is refused, and `2` for unreadable or invalid input. The two exit-1 "nothing to choose from" cases are told apart on stderr: an empty list given says so plainly, and a list where every entry's id failed the repository id rule says "no usable repositories" and the count skipped, instead of reusing the empty-list wording for a list that was not actually empty (#1179).
