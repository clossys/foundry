---
advisor: minor
---

A repository's description, shown as its choice's `detail`, is cleaned by Unicode property: each control character and line or paragraph separator is replaced with a space; each format character (including the tag characters U+E0000-U+E007F, zero-width spaces and joiners, bidirectional marks, soft hyphen and the byte order mark), default-ignorable code point, private-use and surrogate code point is removed; then whitespace is collapsed and the result is cut to 200 characters with a closing ellipsis. Removing the zero-width joiner splits a joined emoji sequence into its separate emoji (#1179).
