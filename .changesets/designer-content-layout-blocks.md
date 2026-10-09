---
designer: minor
---

`ContentSection` gains `layout` (`stacked` or `split`), `media` and `mediaSide`: a split sets the header and text module in 5/12 beside a visual in 7/12 from `tablet-lg`, keeps the reading order header, text, visual, and requires `media`. `FeatureGrid` gains `columns`, `treatment` (`plain`, `rule`, `plate`) and `emphasis` (`item`, `statement`) and renders as before when none is set. `OrderedStepSequence` items take an optional bottom-aligned `visual`. New server-safe blocks: `CardGrid` (plate cards whose spans fill whole 12-unit rows), `Comparison` (before and after) and `TopicList` (a hairline-ruled list in one or two columns).
