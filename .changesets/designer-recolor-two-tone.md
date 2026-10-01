---
designer: patch
---

`recolorSvg`, and so `adoptSuppliedMark`'s `light`, `dark`, `mono`, `favicon` and `appIcon` variants, now knocks out a supplied mark when the whole document is a recognised flat two-tone mark (groups and basic shapes with explicit hex fills, two tones, every first-tone shape before every second-tone shape, no ids, references, styles, classes, text or root paint), so the surface shows through where one tone overlaps the other (#1537). Recognition is one linear pass capped at 32 attributes on a tag, 2000 elements and 32 groups deep; any other input, including one over a cap, is recoloured flat as in the previous release. The contrast check skips only `<mask>`s in the form `recolorSvg` emits.
