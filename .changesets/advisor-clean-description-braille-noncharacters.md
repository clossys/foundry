---
advisor: minor
---

`cleanDescription()` now also removes U+2800 (BRAILLE PATTERN BLANK, a printable character that renders as blank, so it is not caught by any invisible-character Unicode property) and every noncharacter (`\p{Noncharacter_Code_Point}`, permanently reserved code points with no assigned glyph), so a repository description built from either can no longer pad or hide text on the repository-choice card (#1179).
