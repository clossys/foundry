---
launcher: minor
---

New `wouldViolateRootEntries()` judges whether the root names some paths introduce would fail a Controller repository profile's root vocabulary, naming the undeclared and the prohibited names, and is indeterminate when the profile's root vocabulary is unreadable (including one of more than 10,000 entries); it judges the root vocabulary only, not the rest of the profile; new `isRootEntryName()` is Controller's rule for one direct-child name (#1178).
