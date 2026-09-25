---
advisor: patch
---

`repositoryChoiceCard()` refuses a malformed repository listing by position only: every finding names `listing` or `listing[<i>]` and a fixed reason ("is missing a required field", "has a field the contract does not declare", ...), never the shared contract checker's own message or path -- the checker's path can otherwise carry an undeclared field's own name straight from the document. `advisor-repository-card` relays those findings verbatim, so the same guarantee holds end to end (#1179).
