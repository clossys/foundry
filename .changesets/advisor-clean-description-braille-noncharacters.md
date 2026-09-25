---
advisor: minor
---

`cleanDescription()` removes U+2800 (BRAILLE PATTERN BLANK, a printable character that renders as blank, so no invisible-character Unicode property catches it) and every noncharacter (`\p{Noncharacter_Code_Point}`, permanently reserved code points with no assigned glyph) from a repository description, so neither can pad or hide text on the repository-choice card (#1179).
