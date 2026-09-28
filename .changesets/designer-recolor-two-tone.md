---
designer: patch
---

`recolorSvg`, and so `adoptSuppliedMark`'s `light`, `dark`, `mono`, `favicon` and `appIcon` variants, now recolours a supplied mark that declares a root `viewBox` and has two or more fill/stroke tones as a knockout, so where one tone overlaps another the surface shows through instead of both tones becoming the same colour (#1537).
