---
publisher: minor
---

`SectionedViewDocument` gains a tenth kind, `content-section`: a `stacked` or `split` band with at most one closed `block` (`feature-grid`, `card-grid`, `comparison`, `topic-list`, `ordered-step-sequence`, `faq`) and at most one `specimen` media built from closed panel parts, every visible string a `CopyRef`. `feature-grid` items may name an `icon` from the closed `ContentIconName` set (`CONTENT_ICON_NAMES`). New `checkSectionVariety` returns advisory `warning` findings for repetitive page rhythm and leaves validation unchanged. The `SectionedView` web renderer draws `content-section` (see the render changeset); `icon` on a legacy `feature-grid` item is still refused at the web boundary.
