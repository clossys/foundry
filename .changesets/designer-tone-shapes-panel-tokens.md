---
designer: minor
---

`StatusMark` draws a shape per tone (success circle, warning triangle, danger diamond, info open circle, neutral dash), and `Meter` hatches a warning fill and rings an info fill, so tones stay distinct in a greyscale brand. A specimen share with a `status` fills in that tone. Four brandable panel slots, `--radius-panel`, `--ui-border-panel`, `--color-line-panel` and `--ui-elevation-panel`, drive `Card` plate and outline and `SpecimenPanel`; each aliases today's value. A brand file must now declare them to pass coverage (176 tokens, 51 brandable).
