---
designer: patch
---

`recolorSvg`, and so `adoptSuppliedMark`'s `light`, `dark`, `mono`, `favicon` and `appIcon` variants, now recolours a supplied mark that declares a root `viewBox` and has two or more fill/stroke tones as a knockout, so where one tone overlaps another the surface shows through instead of both tones becoming the same colour (#1537). The boundary keeps its contrast for marks whose paint falls into two nested layers, including paint inherited from the root or an ancestor `<g>` and figures drawn through `<use>`; it is not guaranteed for marks with three or more nested layers, where one tone boundary can still be lost.
