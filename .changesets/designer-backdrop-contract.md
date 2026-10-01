---
designer: minor
---

`@clossys/designer/tokens` now exports `BackdropContract`, `checkBackdropContract` and `checkBackdropElement`, which check a hero backdrop's scrim contrast, `aria-hidden`, `pointer-events`, reduced-motion fallback frame, lazy-loading budget and focusable descendants. The scrim contrast is held to the light and the dark theme: the dark theme is read from a `darkTokens` registry the caller supplies, a theme-dependent token with no dark value of its own is reported as unchecked rather than passed, and a page that forces the light theme opts out with `themes: "light-only"`.
