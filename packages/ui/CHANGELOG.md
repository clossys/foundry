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

- The `views` layer: `ErrorView`, `AuthView` — the final rung of this
  package's component ladder (`atoms` → `blocks` → `views`, with `shell` as
  the frame `views` fill), and deliberately a short one. `ErrorView` is a
  full-page error state (404, 500, 403); it composes `blocks/EmptyState`
  rather than reimplementing it, renders the status code as real text in
  the page's own `<h1>`, and takes an optional `details` slot rendered
  inside a native `<details>`, collapsed by default. `AuthView` is a
  full-page authentication shell (sign-in, sign-up, reset, verify): a
  centered card, built on `atoms/Card`, with named `brand`/`heading`/
  `form`/`secondaryAction`/`footnote` slots. `AuthView` implements no
  authentication of any kind — no provider, no form state, no validation,
  no submit handling — it renders the consumer-supplied `form` slot exactly
  as given, the same one-way boundary `Dialog`'s `trigger` slot and
  `EmptyState`'s `action` slot already establish. `ListView`, `FormView`,
  and `DashboardView` are deliberately NOT shipped: by this package's own
  "can one page contain two of them?" test (README, "Placement rules",
  test 3), a page can hold two lists or two forms side by side, so those
  are blocks a consumer composes, not views this package pre-assembles.
- `./views` subpath export, alongside `./atoms`, `./blocks`, and `./shell`.
- `src/ladder.test.ts` extended for the complete ruleset: `views` may
  import `atoms` and `blocks` (proven by two new sanity checks, the same
  shape as the existing `blocks`-imports-`atoms` and `shell`-imports-`atoms`
  ones); no file under `src/views/` may import `shell/` — the mirror image
  of `shell/` never importing `views/`, making `views` and `shell` mutually
  exclusive peers that both build on `atoms`/`blocks` without depending on
  each other. Verified by hand that the new `views`-importing-`shell` check
  actually fails closed: a temporary import from `views/` into `blocks/`
  was added, confirmed to fail the corresponding existing test, then
  reverted.

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
