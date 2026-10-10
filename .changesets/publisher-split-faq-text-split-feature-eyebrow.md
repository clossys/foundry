---
publisher: minor
---

Sectioned views gain three content options. The legacy `faq` section takes `layout: "split"` (header in the narrow column, rows in the wide one; stacked stays the default), rendered like a split `content-section` FAQ. A split `content-section` may omit media when its block is `topic-list`, or 2-column `feature-grid` with item emphasis: the block sits top-aligned in the visual column; `card-grid`, `ordered-step-sequence` and `comparison` still need media. `feature-grid` block items take an optional `eyebrow` copy reference of at most `FEATURE_GRID_ITEM_EYEBROW_MAX_CHARACTERS` (32) resolved characters; resolution and rendering refuse a longer one. `checkSectionVariety` counts a split FAQ as a split band, and the content catalog preview shows a text-only split.
