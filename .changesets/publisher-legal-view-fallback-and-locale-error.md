---
publisher: patch
---

`LegalView` and the launch-pack gallery's back link cap their width with `var(--ui-width-prose-max, none)` instead of a `48rem` fallback, and `LegalView` reports a malformed locale with a fixed message that does not echo the value.
