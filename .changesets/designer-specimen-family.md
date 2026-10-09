---
designer: minor
---

New server-safe blocks: `Specimen`, a labelled figure of 1 to 3 static product-UI panels (`single`, `row`, `stack`, `flow` with a hairline connector), and `SpecimenPanel`, an outline card with a title row, 1 to 3 parts and an optional footer. Parts are `fields`, `status-rows`, `meter`, `table`, `schedule`, `shares` and `files`; every word and number comes through props. Specimens hold no focusable element or scrolling region, reflow at 390px and require an accessible `label`. Budgets (panels, parts, rows, table size) are validated and throw.
