---
"publisher": minor
---

SectionedView and LandingView now render the published `kind: "faq"` shape through the catalog Items FAQ recipe. Question/answer CopyRefs and their provenance remain; the view requires four to six questions. `stacked` keeps its name and `split` maps to `split-end`. Ordinary web uses React Aria disclosures and the server entry uses native details. This intentionally changes FAQ view markup, spacing and split appendix placement; smaller or larger lists are refused. Retained standalone Faq blocks remain available.
