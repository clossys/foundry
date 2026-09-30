---
strategist: patch
---

The facts gate now scans declaration-shaped CSS percentages in a single pass, and its timing tests cover 100,000-character lines made of one long digit run, repeated digit-and-dot pairs, and many declaration starts.
