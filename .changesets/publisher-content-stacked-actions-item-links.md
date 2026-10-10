---
publisher: minor
---

Breaking: a stacked `content-section` whose header is followed by a block or media is refused when it carries actions (`sectioned-view-content-stacked-actions`), and a header-only band with actions is refused when it also carries a footnote (`sectioned-view-content-actions-footnote`). Feature-grid, card-grid, topic-list and step items take an optional `href` that renders the item's title as its link over the whole item; a block links all items or none, at most 6, with distinct destinations (`-item-href`, `-link-partial`, `-link-count`, `-link-duplicate`, `-link-statement`). `checkSectionVariety` warns on a linked split block beside text-column actions. Migration: A stacked band with a block no longer takes actions; move the link to item `href` or the footnote.
