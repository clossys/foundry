# Changelog

All notable changes to this package are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1.0] - Unreleased

### Added

- Initial release: 128 design tokens across 24 families (surface, ink,
  line, accent, status, neutral, overlay, skeleton, text, font, tracking,
  spacing, radius, easing, breakpoint, width, layout, density, border,
  elevation, ring, duration, z, alpha), shipped as CSS custom properties
  (`styles/tokens.css`), an optional Tailwind v4 `@theme` wiring
  (`styles/theme.css`), a brand-binding template (`styles/brand-template.css`),
  and typed JS/TS values (`.`).
- Three-layer contract: primitives (this package) → brand binding (a
  consumer's own file, started from `brand-template.css`) → consumer
  extensions.
