---
designer: patch
---

`recolorSvg`, and so `adoptSuppliedMark`'s `light`, `dark`, `mono`, `favicon` and `appIcon` variants, now knocks out a supplied mark when, and only when, the whole document is a recognised flat two-tone mark, so the surface shows through where one tone overlaps the other instead of both tones becoming one colour (#1537). Recognised: groups (only `transform`) and basic shapes (`path`, `rect`, `circle`, `ellipse`, `polygon`, `polyline`, `line`) with an explicit hex `fill`, exactly two tones, every first-tone shape before every second-tone shape, a root carrying only `xmlns`, a parseable `viewBox`, `width`, `height`, `role`, `aria-label` and `data-clear-space`, and no ids, references, styles, classes, text, comments or root paint. Every other input stays flat: it is recoloured byte-for-byte as in the previous release, so a derived variant is never broken and never gains an attribute its input lacked.
