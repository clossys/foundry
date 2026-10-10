---
publisher: minor
---

Breaking: a `content-section` holds its text block in `block`, not `module`, and `block.type` is the Designer block name in kebab case: `feature-grid`, `card-grid`, `comparison`, `topic-list`, `ordered-step-sequence` or `faq` (formerly `features`, `cards`, `topics` and `steps`). A section that still carries `module` is refused with `sectioned-view-content-module-retired`. The `SectionedView*Module` types are now `SectionedView*Block` types (for example `SectionedViewFeatureGridBlock`), `FEATURES_ITEM_EYEBROW_MAX_CHARACTERS` is `FEATURE_GRID_ITEM_EYEBROW_MAX_CHARACTERS`, the `sectioned-view-content-module-*` codes are `sectioned-view-content-block-*`, and specimen part options report `sectioned-view-specimen-part-option`.
