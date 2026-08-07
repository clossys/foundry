# Changelog

All notable changes to this package are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1.0] - Unreleased

### Added

- Initial release: the `atoms` layer of a three-layer component ladder
  (`atoms` → `blocks` → `views`; only `atoms` ships so far). Four
  components — `Button`, `TextField`, `Badge`, `Card` — built on
  `react-aria-components` for behavior/accessibility and styled with
  Tailwind utility classes generated from `@vespeneventures/tokens`.
- `./atoms` subpath export only; no root export.
