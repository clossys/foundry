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
- The `blocks` layer: `PageHeader`, `Breadcrumb`, `EmptyState`. Each
  composes atoms and/or layout through `ReactNode` slots rather than a
  `mode`/`variant` prop. `Breadcrumb` builds on
  `react-aria-components`' `Breadcrumbs`/`Breadcrumb`/`Link` collection
  components for nav semantics and automatic `aria-current` placement.
- `./blocks` subpath export, alongside `./atoms`.
- `src/ladder.test.ts`: structurally enforces that `atoms/` never imports
  from `blocks/`.
