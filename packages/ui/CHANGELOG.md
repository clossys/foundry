# Changelog

All notable changes to this package are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.3.0] - Unreleased

### Changed

- `@vespeneventures/tokens` dependency range bumped `^0.5.0` -> `^0.6.0`
  (peer and dev) — that package's `0.6.0` is a MINOR release (a `0.x`
  caret range is patch-only, so the old range would not have matched it)
  adding `checkBrandFileCoverage`/`readBrandCss`/the `tokens-brand-check` CLI;
  this package does not use any of the three, but the range must still
  move in lockstep — see `@vespeneventures/tokens`' own CHANGELOG.

### Added

- **`Icon` atom** — the glyph render contract (size, colour, accessibility)
  this package previously had no atom for. Accepts either `glyph`
  (structured `IconNode` data — the shape `@vespeneventures/ui/icons` ships)
  or `children` (raw SVG elements/a component), mutually exclusive at the
  type level. Colour always inherits `currentColor` (no `color`/`fill`/
  `stroke` prop); size reads `@vespeneventures/tokens`' new `--ui-icon-sm`/
  `-md`/`-lg` tokens (`0.5.0`); stroke weight reads the new
  `--ui-icon-stroke` token, applied via `style` (not the `strokeWidth`
  attribute) for reliable `var()` resolution. Accessibility is a
  discriminated union — `decorative: true` XOR a required `label` — ported
  from this scope's own pre-merge, standalone `icons` package's own
  `IconAccessibilityProps`; `src/atoms/internal/icon-contract.check.tsx`
  proves both this union and the `glyph`/`children` union fail to compile
  when violated, and does so in a file `tsc` actually checks (`*.check.tsx`,
  not `*.test.tsx` — see that file's header comment and issue #24 for why
  the distinction matters: a `@ts-expect-error` in a test file is
  transpiled, never type-checked, by this package's toolchain). No
  `<Icon name="..."/>` registry — `glyph`/`children` are ordinary slots,
  this package's own "Slots beat mode props" rule applied one level
  further.
- **`@vespeneventures/ui/icons`** — a new subpath shipping 32 `IconNode`
  glyph-data exports (`AlertTriangle` … `XCircle`, no `Icon` suffix — see
  README.md "Naming convention" for why the suffix was dropped), folded in
  from this scope's now-deleted standalone `icons` package (`0.1.0`,
  never published). Pure data: no React import, no rendering
  logic, `sideEffects: false`; `src/icons/tree-shake.test.ts` (adapted from
  that package's own test, with a new bundle-output marker — a bare
  identifier collides for three renamed pairs under the no-suffix
  convention, see that file's header comment) proves importing one glyph
  bundles exactly that glyph, measured against real `esbuild` output, not
  assumed. `src/icons/icons.test.ts` checks the data's own shape (32
  entries, unique names, well-formed `[tag, attrs]` tuples). Curation
  evidence (how the 32 were chosen), the Lucide→this-package rename table,
  and the refresh procedure against a newer Lucide release all carried over
  into README.md, "Icon glyph data"; `THIRD-PARTY-NOTICES.md` (Lucide ISC +
  Feather MIT) carried over too and is in this package's published `files`
  list, verified present in a real `npm pack` listing before this PR.
  `src/ladder.test.ts` gained a new describe block: `icons` is a pure-data
  leaf BELOW `atoms` (even more foundational than `atoms` itself) — nothing
  under `src/icons/` may import from anywhere else in this package, and
  `atoms` may import `icons` (proven by a real edge: `atoms/Icon.tsx`
  imports the `IconNode` type, type-only, from `icons/types.ts`).
- `@vespeneventures/tokens` peer + dev range bumped `^0.4.0` → `^0.5.0` in
  the same change (a caret range on a `0.x` package is patch-only, so the
  old range would not have matched tokens' `0.5.0` and the workspace link
  would 404 against the registry) — needed for the new `--ui-icon-*`
  tokens `Icon` reads.
- `esbuild` added as a `devDependency` (carried over from the pre-merge
  icons package, for `src/icons/tree-shake.test.ts`).

### Changed

- **This scope's standalone `icons` package is retired.** Its glyph
  data lives at `@vespeneventures/ui/icons` now (see above); its render
  contract lives at `@vespeneventures/ui/atoms`' new `Icon`. The package
  itself, its `packages/icons/` directory, and its workspace entry are all
  removed from this repository. It was never published beyond `0.1.0`
  internal review, so there is no deprecation notice to issue on the
  registry.
- README.md: the "no bundled icon set" claim under "What's deliberately
  not here" → "Shell" is narrowed to what's still true (`Shell` doesn't
  assign icons to nav items on a consumer's behalf) now that this package
  as a whole does ship a glyph set elsewhere.

## [0.2.0] - Unreleased

### Added

- **`charts` layer**: a new `./charts` subpath export, sibling to
  `./atoms`/`./blocks`/`./views`/`./shell` rather than another rung of the
  atoms → blocks → views ladder — `charts` may import `atoms`; nothing
  else in this package imports from `charts` (`src/ladder.test.ts`
  extended accordingly). Four components, dependency-free SVG (no
  charting library dependency): `ChartFrame` (shared plot/axes/grid/
  legend/table container), `BarChart`, `LineChart`, `Sparkline`. Every
  mark reads color through `@vespeneventures/tokens`' new chart-color
  family (`--color-chart-*`, that package's `0.4.0`) via
  `charts/internal/chart-vars.ts`; scale math lives in
  `charts/internal/scale.ts` (`linearScale`, `bandScale`, `timeScale`,
  `niceTicks`) — both `internal/` and unexported from `charts/index.ts`,
  the same convention `atoms/internal/cx.ts`/`ui-vars.ts` already set.
  One axis always (no dual-axis option on `BarChart`/`LineChart`); color
  follows the entity's array position, never its rank; a legend appears
  only for 2+ series; every chart (including `Sparkline`) ships a
  table-view fallback; every chart except `Sparkline` ships a hover layer
  (crosshair + shared tooltip on `LineChart`, per-mark tooltip on
  `BarChart`) reachable identically on keyboard focus.
- `@vespeneventures/tokens` peer + dev range bumped `^0.3.0` → `^0.4.0` in
  the same change (a caret range on a `0.x` package is patch-only, so the
  old range would not have matched tokens' `0.4.0` and the workspace link
  would 404 against the registry).

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
- Eight final atoms — `DateField`, `ComboBox`, `SearchField`, `FileTrigger`,
  `Disclosure`, `ProgressBar`, `Separator`, `Chip` — completing the `atoms`
  layer at thirty components. `DateField` builds on react-aria-components'
  `DateField`/`DateInput`/`DateSegment` for segmented, keyboard-editable date
  entry (per-segment increment/decrement, auto-advance, locale-correct
  order); its `value`/`defaultValue` are `@internationalized/date`
  `DateValue`s, which is why that package is now a real `dependencies`
  entry of this one, not merely an unlisted transitive of
  react-aria-components. A full `DatePicker` was considered and deliberately
  not built instead — it would require a `Calendar` atom this package
  doesn't ship. `ComboBox` builds on react-aria-components' `ComboBox`
  composed with its own `Input`/`Button`/`Popover`/`ListBox`/`ListBoxItem`
  for a searchable, filterable single-choice field over a large option set,
  using the same `options` array shape `Select` already established.
  `SearchField` builds on `SearchField`/`Input`/`Button` for a search input
  with real `type="search"` semantics, a clear button wired through
  context, and Escape-to-clear. `FileTrigger` builds on react-aria-
  components' own `FileTrigger` for OS file-picker access from an arbitrary
  pressable trigger; it deliberately does not accept `className` (react-
  aria-components' own implementation hardcodes the hidden input's
  `className` to `""`, discarding whatever is passed) and deliberately
  excludes upload progress, drag-and-drop, and file previews — a block's
  job. `Disclosure` builds on `Disclosure`/`DisclosurePanel` (both shipped
  in the `react-aria-components@1.20.0` already installed, so no
  `<details>` fallback was needed) for a single expandable/collapsible
  section with correct `aria-expanded`/`aria-controls` wiring and content
  that stays in the DOM (toggling `hidden`) rather than mounting/
  unmounting. `ProgressBar` builds on react-aria-components' own
  `ProgressBar` for determinate and indeterminate progress, correctly
  omitting `aria-valuenow` while indeterminate. `Separator` builds on
  react-aria-components' own `Separator` for horizontal/vertical dividers,
  plus a `decorative` prop (using react-aria-components' `render` escape
  hatch, since neither `filterDOMProps`'s nor `useSeparator`'s own allowlist
  ever forwards a passed `aria-hidden` prop onto the rendered element) for a
  purely visual divider hidden from assistive tech. `Chip` is a removable
  label — a label region plus a remove-affordance region — shipped as a
  distinct component from `Badge` (which is static, one region only) rather
  than a `removable` variant of it, per this package's own "does the
  variant change the SET of named regions?" rule; its remove control is
  react-aria-components' own `Button`, and `removeLabel` is required at the
  TYPE level whenever `onRemove` is supplied, so every chip's remove control
  gets an accessible name that identifies WHICH chip it removes.

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

### Added

- Six more blocks — `Form`, `FieldGroup`, `ConfirmDialog`, `Toolbar`,
  `NavGrid`, `SectionHeader` — completing the `blocks` layer at twelve
  components. `Form`
  is a form's own layout (an optional heading, the fields region, an
  error-summary region, an actions region) and implements NO validation
  logic or form state of its own: react-aria-components already carries
  per-field validation, and most consumers layer their own form library
  on top, so a shared component that tried to own either would need an
  escape hatch for every consumer using a different one. Its error
  summary is the real accessibility payoff — `role="alert"` plus a
  programmatic focus move onto the region itself the moment a new,
  non-empty `errors` array is passed, with each entry a real
  `<a href="#fieldId">` linking straight to its field. `FieldGroup` groups
  a related set of fields under a real `<fieldset>`/`<legend>` pair (not
  `role="group"`/`aria-labelledby` — see its own README section for why),
  with a `layout` prop (`"single" | "multi"`) for the fields' own grid.
  `ConfirmDialog` is `Dialog` composed with a fixed heading/message/
  Cancel-Confirm-actions shape — the deliberate follow-up `Dialog`'s own
  section already called out; `tone="destructive"` never relies on colour
  alone (the confirm button's own label, not just its `danger` styling,
  is what has to name the action), and default focus lands on Cancel for
  a destructive confirmation (the safer action) versus Confirm otherwise.
  It implements no imperative `confirm()` API — a `trigger` slot, exactly
  like `Dialog`. `Toolbar` builds on react-aria-components' own `Toolbar`
  primitive (shipped in the installed `react-aria-components@1.20.0`) for
  real roving-focus arrow-key navigation between `leading`/`search`/
  `trailing` slot contents, rather than a hand-rolled `role="toolbar"`.
  `NavGrid` renders a responsive grid of navigation cards from
  `{ id, title, description?, icon?, href? | onSelect? }` data; each card
  is a real `<a>` (this package's own `Link`, `variant="standalone"`) or
  `<button>` (`Button`, `variant="ghost"`) — never a `<div>` with an
  `onClick` — with the whole card, not just the title, as the click/
  keyboard target. `SectionHeader` is a heading for a section WITHIN a
  page — eyebrow, title, description, actions slot — distinct from the
  once-per-page `PageHeader`: a page routinely holds several
  `SectionHeader`s, which is what makes it its own block rather than a
  `PageHeader` variant (test 3). `level` (`2 | 3 | 4 | 5 | 6`, default
  `2`) picks which heading element `title` renders as, so a page's
  document outline stays unbroken regardless of how deeply a
  `SectionHeader` is nested; it renders a plain `<div>`, not a `<header>`,
  since a bare top-level `<header>` per instance would register a second
  `banner` landmark per section — invalid document structure for a block
  a page can hold several of.
- `token-parity.test.ts`'s `KNOWN_NON_CLASS_MAPS` is unchanged by this
  release — none of the six new blocks introduce a `Record<...,
  string>` map that isn't a `*CLASSES` variant map.

### Known issues

- `Link` (an atom, out of scope for this PR) applies `outline-none` in its
  base class but no replacement focus-visible styling of any kind, unlike
  `Button`/`TextField`/every other interactive atom here — a keyboard user
  tabbing to any `Link` (including inside `Breadcrumb`, and now inside
  `NavGrid`'s own `href` cards) gets no visible focus indicator at all.
  `NavGrid` works around this locally by adding its own
  `focus:shadow-[var(--ui-ring-focus)]` to the card's `className`; `Form`'s
  error-summary links do the same. The underlying atom bug is unfixed —
  flagged here for whoever owns `src/atoms/Link.tsx` next.
