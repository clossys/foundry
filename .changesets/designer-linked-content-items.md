---
designer: minor
---

`FeatureGrid`, `CardGrid`, `TopicList` and `OrderedStepSequence` items take an optional `href`: the item's title renders as its one link, named by the title, with the T4 chevron shown at rest, a hit area stretched over the item and a focus ring around it, and a bare item gains a hover plate in the band's other ground. A linked item whose parts hold another link, a button, a field or an `onClick` throws a `TypeError`, as does `href` on a statement `FeatureGrid` item. `NavGrid` linked cards use the same anatomy: the title is the link, and the icon and description sit outside it.
