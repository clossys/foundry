---
designer: minor
---

`OrderedStepSequence` step headings now use the item-heading type shared with `FeatureGrid` and `TopicList` items (`text-body`, body font, medium weight), and the connector runs from one ordinal to the next (a rail in the column, a hairline in the row) in `line-strong`, so it reads in light and dark schemes. With visuals, each step spans three shared `subgrid` rows from `tablet-lg`, so visuals start on one top line when step copy differs in length. `Comparison` sides share `subgrid` rows side by side, so labels, copy and visuals line up and both panels start level when the descriptions differ; without `subgrid` support both still stack in order. `FeatureGrid` items take an optional `eyebrow`, a caption above the item heading.
