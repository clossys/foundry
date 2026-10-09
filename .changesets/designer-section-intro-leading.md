---
designer: minor
---

New `--leading-display` (1.05) and `--leading-heading` (1.15) tokens and `leading-display` / `leading-heading` utilities set display and section headings. New `SectionIntro` block: a section's eyebrow, heading, description and actions, where each gap exceeds the heading's line gap and grows toward the action. `display` emphasis is the opening (`text-display-m`, `text-display-l` from `tablet`); `section` is every band after it. `Hero` and `ContentSection` compose it, and `designer-hero-css-check` now requires `text-display-m` and `tablet:text-display-l` instead of `text-display-l`.
