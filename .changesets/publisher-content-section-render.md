---
publisher: minor
---

`SectionedView` and `LandingView` now render `content-section` bands on the client and server entries. Each band is one Designer `ContentSection`: its block maps to `FeatureGrid`, `CardGrid`, `Comparison`, `TopicList`, `OrderedStepSequence` or `Faq`, its media to a labelled `Specimen` figure, item icons to Designer icons, and actions to text links. A split `faq` block takes no media and places its rows in the visual column. The contract changes to match: a split FAQ with `media` is refused, and an item `eyebrow` is accepted on cards items only. A section that would not render as authored is refused with a `RenderError` naming its path. Feature-grid item icons are still refused by the web renderer.
