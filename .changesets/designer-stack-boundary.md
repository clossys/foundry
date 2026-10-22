---
designer: patch
---

The README now states that on the compiled no-Tailwind path `className` applies only classes present in `compiled.css` or the consumer's own CSS, and its first `Card` example no longer uses a utility missing from `compiled.css`; a package test now fails when a source file imports a UI library outside the atoms and blocks allow-lists.
