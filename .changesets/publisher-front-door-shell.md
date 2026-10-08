---
publisher: minor
---

Give `AuthView`, `CaptureView` and `BoundaryView` one front-door shell: header pass-through (`nav`, `headerAction`, a secondary header action, `ground`), a `notes` block below the card (`AuthView`'s `secondaryAction` becomes its deprecated alias), `BoundaryView` restructured into a page header block, the action in a card and notes with `className`, `style` and other attributes moved to its outer element, and `SignInForm` and `ResetForm` aligned on disabled fields, back control and focus when unavailable or invalid.
