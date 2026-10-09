---
designer: minor
---

Two new tokens: `--radius-surface` (`rounded-surface`, an alias of `--radius-default`) for content plates, and `--ui-border-rule` (2px) for emphasis rules. `Card` gains `variant` (`raised` default and unchanged, `plate`, `outline`) and `ground`: a plate takes the other ground from its section with no stroke or shadow, an outline is a raised panel with one hairline edge. New server-safe atoms `StatusMark` (a dot and a visible label for one data state) and `Meter` (a value against a scale and an optional limit, visible text plus a decorative bar). `atoms/server` now also exports a hook-free `Avatar`. Eight icons join the set for content lists: `Landmark`, `Briefcase`, `Globe`, `ShieldCheck`, `Scale`, `ArrowRight`, `FileCheck`, `Layers`.
