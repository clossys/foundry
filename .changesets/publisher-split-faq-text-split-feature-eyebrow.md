---
publisher: minor
---

Sectioned views gain three content options. The legacy `faq` section takes `layout: "split"` (header in the narrow column, rows in the wide one; stacked stays the default), rendered like a split `content-section` FAQ. A split `content-section` may omit media when its module is `topics`, or 2-column `features` with item emphasis: the module sits top-aligned in the visual column; cards, steps and comparison still need media. Features items take an optional `eyebrow` copy reference of at most `FEATURES_ITEM_EYEBROW_MAX_CHARACTERS` (32) resolved characters; resolution and rendering refuse a longer one. `checkSectionVariety` counts a split FAQ as a split band, and the content catalog preview shows a text-only split.
