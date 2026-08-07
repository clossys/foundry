# Changelog

All notable changes to `@vespeneventures/icons` are documented in this
file. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.1.0] - Unreleased

Initial release.

### Added

- 32 icon components (`AlertTriangleIcon` through `XCircleIcon` — see
  README.md "The icon set" for the full list and the consumer-evidence
  method behind it), each strokes with `currentColor` and sizes from
  `@vespeneventures/tokens`' `--spacing-*` scale via a required `size?:
  "sm" | "md" | "lg"` prop.
- `createIcon(name, node)` — the extension seam for building additional
  icon components with the identical size/color/accessibility contract,
  without forking anything in this package.
- A compile-time accessibility contract (`IconAccessibilityProps`):
  every icon requires either `decorative: true` or a `label`; supplying
  neither, or both, is a TypeScript error.
- `IconProps`, `IconSize`, `IconNode` types.
