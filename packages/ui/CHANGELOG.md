# Changelog

All notable changes to this package are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1.0] - Unreleased

### Added

- Initial release: the `atoms` layer of a three-layer component ladder
  (`atoms` → `blocks` → `views`). Five components — `Button`, `TextField`,
  `Badge`, `Card`, `Breadcrumb` — built on `react-aria-components` for
  behavior/accessibility and styled with Tailwind utility classes generated
  from `@vespeneventures/tokens`. `Breadcrumb` builds on
  `react-aria-components`' `Breadcrumbs`/`Breadcrumb`/`Link` collection
  components for nav semantics and automatic `aria-current` placement; it
  ships as an atom because its parts (crumbs) are homogeneous repeats, not
  named regions.
- `./atoms` subpath export.
- The `blocks` layer: `PageHeader`, `EmptyState`. Each owns the internal
  layout of multiple named regions and composes atoms and/or layout
  through `ReactNode` slots rather than a `mode`/`variant` prop.
- `./blocks` subpath export, alongside `./atoms`.
- `src/ladder.test.ts`: structurally enforces that `atoms/` never imports
  from `blocks/`.
- Eight more atoms — `Link`, `Checkbox`, `Switch`, `Select`, `Textarea`,
  `Avatar`, `Spinner`, `Menu` — bringing the `atoms` layer to thirteen
  components. `Link`, `Checkbox`, `Switch`, `Select`, and `Textarea` are
  built on the matching `react-aria-components` primitive, the same way
  `Button`/`TextField` are; `Menu` builds on `MenuTrigger`/`Menu`/
  `MenuItem`/`Popover` for its open/close, arrow-key navigation, and
  disabled-item handling. `Avatar` and `Spinner` are plain markup, like
  `Badge`/`Card` — neither is interactive, so neither needs a
  react-aria-components primitive.
