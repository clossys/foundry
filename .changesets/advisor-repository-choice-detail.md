---
advisor: minor
---

A repository's description, shown as its choice's `detail` on the repository-choice card, is treated as untrusted text: control characters, bidirectional and invisible formatting characters are removed, whitespace is collapsed, and it is cut to 200 characters with a closing ellipsis (#1179).
