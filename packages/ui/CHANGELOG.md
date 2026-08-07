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
- The `shell` layer: `Shell`, the persistent application frame (`Header`,
  `SideNav`, `Main`, `Rail`, `Footer` slots — every one but `Main`
  optional, and correct with none of them: no empty grid track, no
  phantom spacing), plus its skip-to-content link. Slots, never a
  `mode`/`variant` prop, for structurally different chrome. `SideNav`
  collapses to an icon-rail width below the `tablet` breakpoint and `Rail`
  hides entirely below `desktop`, both CSS-only.
- `Toaster` and the imperative `toast` API (`toast.success`/`.error`/
  `.warning`/`.info`, plain `toast(...)`, each returning a dismiss
  handle) — a runtime service, not a rung of the atoms → blocks → views
  ladder, shipped alongside `shell` because its lifetime requirement is
  identical. Built on react-aria-components' `ToastRegion`/`Toast`/
  `ToastContent` for portal rendering, focus management, and pausing on
  hover/focus; overrides `ToastContent`'s always-assertive default so only
  `danger` toasts are an assertive live region (`role="alert"`) — every
  other variant is polite (`role="status"`).
- `./shell` subpath export, alongside `./atoms` and `./blocks`.
- `src/ladder.test.ts` extended: no file under `src/atoms/` or
  `src/blocks/` may import `views/` or `shell/`, and `shell/` may never
  import `views/`. `shell/` importing `atoms/` (and `blocks/`, though
  nothing under `shell/` currently does) remains permitted, the same
  direction `blocks/` importing `atoms/` already was.
- Three more atoms — `Dialog`, `Tabs`, `Table` — bringing the `atoms` layer
  to sixteen components. `Dialog` builds on react-aria-components'
  `DialogTrigger`/`ModalOverlay`/`Modal`/`Dialog`/`Heading` for a modal
  overlay with a focus trap, focus restoration on close, Escape-to-dismiss,
  and a page scroll lock, plus a `size` prop and a composable
  `Dialog.Heading` sub-component that wires the dialog's `aria-labelledby`.
  `Tabs` builds on `Tabs`/`TabList`/`Tab`/`TabPanel` for roving-tabindex
  arrow-key navigation between panels, via `Tabs.List`, `Tabs.Tab`, and
  `Tabs.Panel` sub-components. `Table` ships compositional table
  primitives — `Table.Header`, `Table.Column`, `Table.Body`, `Table.Row`,
  `Table.Cell` — built on `Table`/`TableHeader`/`TableBody`/`Column`/`Row`/
  `Cell`, with `sortDescriptor`/`onSortChange` sorting and
  `selectionMode`/`selectedKeys` row selection passed straight through;
  `Table.SelectAllCheckbox` and `Table.SelectionCheckbox` reuse this
  package's own `Checkbox` atom (via react-aria-components'
  `slot="selection"`) for the selection column, including the
  indeterminate select-all state — the one place in this package where an
  atom composes another atom, which `ladder.test.ts` and the README both
  confirm is the explicitly-permitted direction (a sibling atom, not a
  `blocks/` import). `DataTable` and `ConfirmDialog` — the finished,
  opinionated assemblies built on `Table`'s and `Dialog`'s primitives —
  remain deliberate follow-ups, not shipped here.
- Six more atoms — `Field`, `Skeleton`, `Tooltip`, `Banner`, `RadioGroup`,
  `Popover` — bringing the `atoms` layer to twenty-two components. `Field`
  is the general label/description/error wrapper `TextField` bundles for
  the text-entry case, for a control this package doesn't ship an atom for;
  its `children` is a render prop (not `React.cloneElement`) receiving the
  generated id and ARIA wiring to spread onto whatever control it wraps.
  `Skeleton` is a loading placeholder (`shape`: `"text" | "block" |
  "circle"`) styled with `--color-skeleton-fill`, with the same
  "decorative unless it's the one accessible loading signal"
  `aria-hidden`/`role="status"` split `Spinner`'s own `label` prop already
  uses. `Tooltip` builds on react-aria-components' `TooltipTrigger`/
  `Tooltip` for hover-AND-focus opening, Escape-to-dismiss, and the
  warm-up/cool-down delay between tooltips shown in quick succession.
  `Banner` is a persistent inline message region (not a toast) over the
  same four status tokens `toast(...)` and `Badge` already share, with
  `role`/`aria-live` following severity the same way `Toaster`'s own
  `ToasterContent` does. `RadioGroup` builds on react-aria-components'
  `RadioGroup`/`Radio` for roving-tabindex arrow-key navigation between a
  visible set of mutually-exclusive options, via a composable
  `RadioGroup.Radio` sub-component. `Popover` builds on `DialogTrigger`/
  `Popover`/`Dialog` — the general anchored-overlay primitive, for content
  shapes `Menu`/`Select`/`Tooltip`'s own specific popovers don't already
  cover.

### Changed

- `token-parity.test.ts` redesigned: candidate Tailwind classes (from a
  `className="..."` attribute, a `cx(...)` call's arguments, or a
  `Record<Variant, string>` variant map) are now compiled for real against
  this package's own token CSS, via `tailwindcss`'s own
  `__unstable__loadDesignSystem` JS API, instead of matched against a
  hand-maintained per-prefix allow-list of Tailwind's own reserved
  keywords. The allow-list approach had already needed one round of fixes
  (see `0.1.0`'s "Fixed" entry above) and still rejected `border-collapse`
  and `border-b-2`/`border-b-0` the moment `Table` and `Tabs` needed them,
  forcing a `style`-based `borderCollapse` and an inset `box-shadow`
  standing in for a real border in place of both. Compiling the real thing
  has zero false positives by construction — verified against all six
  utilities this package has now had rejected across two rounds — while
  still catching an invented token class (`bg-surface-elevated`) exactly as
  before. The raw `var(--ui-*)`/`var(--color-*)` check stays list-based
  against `TOKENS`, since Tailwind can't validate those; scoping the class
  scan to the three syntactic shapes above (rather than any class-shaped
  substring anywhere in a file) also structurally eliminates the previous
  version's `--ui-border-hairline`-contains-`border-hairline` collision,
  with no blanking pass needed to work around it.
- `Table`'s `border-collapse` and `Tabs`' selected-tab underline restored to
  real Tailwind classes (`border-collapse`; `border-b-2` with a
  transparent/accent border color, always applied to avoid a 2px layout
  shift on selection) now that the redesigned `token-parity.test.ts` no
  longer rejects either.

### Fixed

- `token-parity.test.ts` no longer false-positives on Tailwind's own
  non-token utility keywords (`text-center`, `border-b`, `mx-auto`,
  `text-inherit`, `bg-transparent`, and more — see the new
  `ALLOWED_SUFFIXES` allow-list, verified against a real
  `@tailwindcss/cli@4.3.3` compile) or on a token's own property name
  containing a Tailwind-class-shaped substring (`--ui-border-hairline`
  matching as if it were a `border-hairline` class). Both false positives
  had forced real workarounds: `EmptyState` had dropped `text-center` for
  a flex-only centering approach, `Shell` had moved several classes into
  inline `style`, and — the most serious instance — `Shell` had abandoned
  the `--ui-border-hairline` token entirely for a hardcoded `"1px"`. All
  three are restored.
- `Button`, `Switch`, and `Checkbox` no longer silently drop a
  consumer-supplied `style` prop. Each set `style` unconditionally via a
  render-prop function; a `style` object or function passed by a consumer
  is now merged in, with the consumer's values winning on conflict — the
  same precedence `className` already had via `cx`/`tailwind-merge`.
