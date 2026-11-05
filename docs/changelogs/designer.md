# Changelog

All notable changes to this package are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## Unreleased

- Add the ErrorState, StatGroup, RecordCards, CallToAction, NoticeList and Gallery Section blocks, and give the consent, error-state, stats, data-grid, cards, call-to-action, notices and gallery Section slots a Foundry candidate (ConsentBanner and DataTable cover consent and data-grid).

- Add the RelationGraph Navigation Material: layered directed relationships, one keyboard-navigable list, safe-link refusals and a cycle fallback.

- Add the FlowCanvas Block Material: a server-rendered node-and-edge diagram with a deterministic layered layout (`layoutFlowCanvas`), arrowheads and edge labels drawn from tokens, an ordered node list as its accessible source, edge-following keyboard navigation and a host-controlled selection.
- Add the registered CommandMenu Navigation Material with host-controlled groups, filtering and open state, modal search focus and restoration, keyboard and pointer activation, and an optional SSR-safe opening shortcut.
- Add the AppNavigation Block Material, a typed two-level host navigation tree, route ancestry and breadcrumbs, accessible rail destinations, Drawer focus handoff and a fixed footer slot. Give the Drawer close button a token-sized ghost icon presentation and visible keyboard focus.

- Add AccountMenu with expanded/collapsed actor triggers, grouped commands, controlled preferences and host close/route callbacks. Menu.Section provides named groups and section-local checkbox selection. Menu keeps normal hover/focus outlines suppressed and adds an outline only for focused enabled items in forced colors; AccountMenu uses the Button focus ring with a forced-color fallback, retains expanded label-in-name, validates required labels and destinations, and bounds long actor details.
- Add Panel, Drawer and ResizablePane Block Materials with source-backed composition records, and a named ResizeHandle Atom with bounded keyboard and pointer interaction. Drawer reuses the Dialog lifecycle and releases it on route and breakpoint changes. Document the forty-first Atom without changing existing Dialog defaults.

## 0.12.0 - 2026-10-16

- Retire the executable Landing views and their copied rendering graph. SiteFrame overlays accept one direct registered Hero and retain glass-header, heading and layout refusals.

- Add optional inverse brand and navigation ink, muted eyebrows, wide hero copy, display heading scale, and a transparent footer top rule while preserving default rendering.
- Link Designer setup to the Publisher frame wiring guide for brand, CSS and frame configuration.

## 0.11.0 - 2026-10-16

- Site navigation can collapse into a mobile disclosure with an inline fallback when scripting is unavailable, and header action links can show a text label without an icon.

## 0.10.0 - 2026-10-14

- SiteHeader takes `placement="overlay"` to sit fixed over the first block, transparent at the top of the page and a blurred glass plate once the page scrolls, with `tone` for the ink a light or dark ground needs and `menuOpen` to hold the glass while a menu is open.
Add the brandable `--color-surface-glass`, `--color-surface-glass-inverse` and `--blur-glass` tokens, all three required brand slots; the brand template lists the two glass colours in every theme block and the blur in the light block.
Upgrading has four visible effects on an existing site: `designer-brand-check` and `publisher-preview` exit 1 on a brand file until it declares all three new slots, `designer-contrast-check` exits 2 (`unresolvable-token`) on a consumer `tokens.css` that does not declare the two glass colours, and the contrast gate now fails a brand whose `ink-primary` or `ink-on-inverse` is translucent, reporting that the foreground "must be opaque".
The contrast gate checks primary and on-inverse ink over each glass composited on white and on black, taking the lower of a linear-light blend and the gamma-encoded sRGB blend browsers paint; a pair's `compositeOver` may now be a literal opaque colour, and a translucent or malformed literal is reported unchecked.
Inside an overlay header, focus indicators (the `--ui-ring-focus` ring and every `:focus-visible` outline) take the tone's ink instead of `--color-accent`, which falls below 3:1 on the glass, and the gate checks that ring on each glass at 3:1 over both backdrops; it checks no child ink other than the tone's own on the glass.
Publisher's preview stylesheet carries the overlay header rule.

## 0.9.0 - 2026-10-13

- Consumers can validate static art declarations with Designer's typed slot contract and render checked photos or token-painted vectors into Publisher backdrop and media seams.
- Document the literal-SVG and referenced-symbol limits of passive use/image references in NavGrid, its private LinkGrid plate list, and Specimen status rows.
- Consumers can compose status lists with Index rows and per-item badges using the topics recipe, with a Publisher preview example and configuration guidance.

## 0.8.0 - 2026-10-12

- Give connected item geometry, panel aliases and catalog styling explicit token fallbacks while preserving live theme overrides. Document how source-checkout generators relate to installed packages, and check required labels and supported split media layouts through compiled type assertions.
- Keep chart palette fallbacks in sync with the token registry and preserve scene labelling and status-mark styling. Correct styling-data lint classification and catalog test setup.
- `publisher-preview` writes `content-catalog.html`, a function index linking nine catalog pages: Overview, Introduce, Show, Explain, Index, Sequence, Compare, Frame and Parts. Examples, configuration references and recipe links render against the supplied brand CSS. Preview pages, including nested catalog pages, load `publisher-preview.css`, generated from the preview stylesheet source with preflight and the classes used by Designer components and Publisher views. Designer ships `CONTENT.md`, a copy cookbook covering block choice, slots, word budgets and page-variety rules, linked from its skill.
- Add AnatomyCallouts for a specimen panel with three-to-five inline numbered markers and a responsive ordered key, with authored accessible labels, caller instance IDs, label-line target checks and numeral contrast checks.
- The `AuthView` section of the README no longer documents `internalNote`; it now says the view prints no developer text and that a missing sign-in provider setting is reported in the server log, not on the page.
- Move `readBrandCss`, `assertTailwindMergeVersion` and the brand-CSS read result types from `@clossys/designer/tokens` to the new Node-only `@clossys/designer/tokens/server` entry, so `@clossys/designer/tokens` can be bundled for the browser; update imports of those names.
- New `buttonLinkClassName(variant, size)` (from `atoms` and `atoms/server`) gives a plain `<a>` the `Button` look with the package-standard focus outline. `Faq` answers now ease open and shut, CSS only and instant under reduced motion. Server rows use `details-motion` on `::details-content` and stay in block flow. Client rows use `disclosure-panel-motion`.
- Add canonical Item, Items, Matrix and SpecimenPanel content. FeatureGrid and OrderedStepSequence retain their published props and authored rendering. NavGrid uses shared title links: an ordinary href tile now has a title-only accessible name and a stretched tile hit area, with its icon and supporting copy outside the anchor. Grouped Items lists take their accessible names from group labels. Linked and disclosed Items allow passive SVG and image resources, with nested-control validation. Native disclosure headings retain their typography and collection scale.
- Items supports two actor lanes in connected columns or stacks across 3–5 steps, including four without a count warning. Matrix labels are optional but must appear on both sides or neither; without labels, each side heading is the semantic heading. MatrixSide requires either points or a visual, not both, and Matrix refuses description-only sides; descriptions remain optional lead copy.
- Distinguish unordered explanatory collections from compact index rows and disclosures using typography and spacing tokens. Explanatory headings use h2 for standard size, h1 for display size and h0 for statement scale. Bento follows its frame size, statement headings centre their copy, and lane visuals keep each step's stagger. Each Matrix side uses its actual heading in the semantic outline. Three-column rows support complete, ungrouped linked plates with reveal set to all.
- `ConsentBanner` accepts an optional `status` that renders in a polite live region mounted after the body, which stays empty until a status is passed.
- Add compact, standard and display ContentSection frames with responsive spacing and stacked, split-start and split-end layouts. Split bands place header and text in a 5/12 column beside a 7/12 companion from tablet-lg, in reading order. Children can occupy the companion column when media is omitted; header-only splits place supporting copy beside the heading. Empty-string children select the header-only layout and modules fill their column width. Explicit sizes own padding; supported split/mediaSide aliases retain their media-based rendering. Hero supports display and compact sizes, with default as an alias for display.
- `Hero` takes `align` (`HeroAlign`), and a centred `Hero` holds its text block to the prose measure with a balanced heading and a pretty-wrapped description.
- Add `ContentSection`, one marketing section anatomy: a header group (eyebrow, heading, description, actions) held to the prose measure, followed by a module slot for one or more content modules at fixed spacing.
- Add `MediaFigure`, large media as a section module, in an optional frame with a caption underneath, across the column or at the content measure.
- Two new tokens: `--radius-surface` (`rounded-surface`, an alias of `--radius-default`) for content plates, and `--ui-border-rule` (2px) for emphasis rules. `Card` gains `variant` (`raised` default and unchanged, `plate`, `outline`) and `ground`: a plate takes the other ground from its section with no stroke or shadow, an outline is a raised panel with one hairline edge. New server-safe atoms `StatusMark` (a dot and a visible label for one data state) and `Meter` (a value against a scale and an optional limit, visible text plus a decorative bar). `atoms/server` now also exports a hook-free `Avatar`. Eight icons join the set for content lists: `Landmark`, `Briefcase`, `Globe`, `ShieldCheck`, `Scale`, `ArrowRight`, `FileCheck`, `Layers`.
- Add a call-to-action ladder: Button gains `tonal` (T3, a neutral tonal fill) and `quiet` (T4, a chevron text button with a 44px tap block, a hover underline and a 2px chevron nudge that stays still under reduced motion), both drawn per `ground` (`base`, `sunken`, `inverse`). Add the `IconButton` atom (circle or square, 36px or 44px, `label` required) and server-safe `iconButtonClassName`. Add five brandable tokens, `--color-control-tonal`, `-tonal-hover`, `-tonal-inverse`, `-tonal-inverse-hover` and `--color-control-quiet`, with contrast pairs; a brand file that sets every other brandable token now reports these five as uncovered until it sets them.
- Dialog sizes now compile to 24rem, 28rem and 42rem maximum widths, so consumers can drop their width overrides.
- `Faq` questions sit between ground-matched hairlines, use body-l type and expose the whole row as the hit area. A ChevronDown turns when open and remains still under reduced motion. Server summaries hide the native marker with summary-marker-none. ContentSection uses SectionIntro headings: section emphasis scales from h1 through h0 to display-m with leading-heading; display emphasis uses display-m and display-l with leading-display.
- Add a compact hero heading treatment for pages that lead into task content.
- `iconButtonLinkClassName(ground)` styles an icon-only link as a circular button: a 44px tap target from `--ui-layout-tap-target`, a 1px edge, and token surfaces for `base` and `inverse` grounds. Hover and pressed states change the surface and edge. Focus-visible adds the accent outline over a halo in the link's own surface, and transitions turn off under reduced motion. A new `scroll-cue` utility fixes an element to the bottom of the browser window, clear of the safe-area inset, and fades it out over the first 132px of page scroll with a scroll-driven animation, then hides it, which also removes it from the tab order. Under reduced motion it hides in one step instead of fading. Engines without scroll-driven animation get no fixed placement: the element scrolls away with the page.
- Add numbered and connected Items with authored visuals, visual captions, explicit terminal markers and two named actor lanes. Lane sequences support three to five steps, including four, with responsive joins and visible actor labels. Ground-matched hairline tracks stay outside link hit areas; continuation markers accept meaningful renderable labels. Independent disclosed rows use FAQ row anatomy and motion. Server rendering provides keyboard-operable details rows.
- Keep ordered Items decoration consistent with and without CSS preflight, let numbered item bodies fill their available width, and reserve terminal-label space only in the final visual row. Export ItemsLane and forward standard aria-labelledby references to the actual lists. Strengthen disclosure motion and refusal checks.
- Add Item and Items with plain, rule and plate treatments, standard or display sizes, badge and meta slots, labelled groups and bounded rows, columns, bento and stacked arrangements. Items selects item or statement scale and renders semantic lists; standalone Item titles can be h3 or h4. Linked titles own one anchor with a stretched hit area and ground-matched focus ring; supporting copy and decorative icons sit outside it. Linked content is checked for nested controls. Plain and rule links use smaller outsets below tablet; plate borders remain visible in forced colors. Status badges use an opaque token surface across grounds.
- Add server-safe Matrix for two parallel sides on equal plates, with stable IDs and required headings. Labels are optional and supplied on both sides or neither. Each side has two to four matched points or a supplied visual, with optional description lead copy; featured names the side with an accent rule. Shared subgrid rows align copy and visuals while retaining source order. Side headings use the supplied h2-through-h6 semantic level; labels are separate caption text. Both plates use their ground's primary body ink.
- Add MediaFigure with frameless media on the section ground by default, an optional framed hairline, a caption and column or content measure. Token notes use oklab for neutral tint mixing.
- Keep the dashed previous-value marker visible inside a Meter fill by backing its dash gaps with the base surface.
- Back specimen status badges with the opaque base surface used to qualify their tint and text contrast.
- NavGrid href cards use title-only accessible names, with supporting copy outside the anchor; published 0.7.1 names also included supporting copy. Ordinary cards keep a full-tile hit area, including passive SVG sprite references in titles, icons and descriptions. When descriptions contain controls, the separate title link has a token-backed minimum tap target and focus outline, and description controls keep their own hit areas and keyboard stops. Linked titles and decorative icons require noninteractive content.
- Adds the `outline` `ButtonVariant`: a transparent button with the same box, size, radius and type as `primary`, edged by an inset ring in the surrounding ink, for a second call to action beside a primary one. `SectionIntro`'s actions row now carries its ground's primary ink (and `data-section-intro-actions`), so an outline button reads on base, sunken and inverse grounds. `ContentSection` takes an optional `footnote`: one small, muted sentence closing the band, holding at most one underlined link. `CONTENT.md` now writes section actions as 1-2 buttons of 2-4 words starting with a verb.
- Exclude source *.test.json snapshots and `__fixtures__` directories from Designer and Publisher package contents. Artifact-safety checks also reject *.spec.json and complete `__fixtures__` directory segments alongside existing source test-file checks. Runtime JSON, shipped examples and partial fixture-like names remain permitted.
- Add server-safe RecordLedger for named records on rules, with one to three labelled groups, optional final owner details and a caller-supplied caption. Caller-owned instance IDs name the figure and groups. Row budgets and a single caller-labelled flag refuse malformed data, and grounded status labels retain their contrast. SpecimenPanel status rows provide static record visuals with optional mobile row caps and nested-control checks.
- Add --leading-display (1.05) and --leading-heading (1.15) tokens and matching utilities. SectionIntro composes an eyebrow, heading, description and actions with progressively larger gaps. Display emphasis uses text-display-m, then text-display-l from tablet; section emphasis uses text-h1, text-h0 from tablet and text-display-m from tablet-lg. Hero and ContentSection share this anatomy while keeping semantic heading levels independent of visual scale.
- Add `SiteHeader.ActionLink`, a header link with an icon and a label from the tablet breakpoint up and the icon alone below it (the label stays its accessible name), an `isCurrent` prop that sets `aria-current="true"`, and a tap-target minimum size; it supersedes `surfaceLabel` for environment links.
- New server-safe blocks: `Specimen`, a labelled figure of 1 to 3 static product-UI panels (`single`, `row`, `stack`, `flow` with a hairline connector), and `SpecimenPanel`, an outline card with a title row, 1 to 3 parts and an optional footer. Parts are `fields`, `status-rows`, `meter`, `table`, `schedule`, `shares` and `files`; every word and number comes through props. Specimens hold no focusable element or scrolling region, reflow at 390px and require an accessible `label`. They reset their own figure, list, definition and table margins and padding, so they lay out the same with or without a CSS preflight. Budgets (panels, parts, rows, table size) are validated and throw.
- Specimen panels can show badges, cap status rows on small screens and pair Meter measurements with prior values. Anatomy keys share Item typography; RecordLedger holds record groups. Scene illustrations retain seeded placement with flat documents.
- Theme init scripts survive host minification, escape inline storage keys, and support a defaultTheme fallback that can match ThemeProvider’s defaultPreference.
- StatusMark distinguishes tones by shape: success circle, warning triangle, danger diamond, info open circle and neutral dash. Meter hatches warning fills and rings info fills; specimen shares can use a status tone. Four brandable panel slots, --radius-panel, --ui-border-panel, --color-line-panel and --ui-elevation-panel, control panel identity in Card and SpecimenPanel. Brand coverage requires these slots alongside the other brandable tokens.
- Content blocks use responsive SectionIntro heading scales, accent eyebrows and ground-aware item typography. Step ordinals and content icons carry the accent. Meter supports accent tone and figure emphasis. Designer ContentSection supports section or display emphasis when no explicit frame size is supplied. Specimen panels use floating elevation and respond to their own width, so tables stack and fields reduce columns when narrow. A lone last feature or card fills the row at tablet.
- Designer Items selects collection scale with item or statement. Publisher renders link-index recipes as plate rows while retaining raw linked columns. Authored canonical content-section grounds are inverse or omitted; omission delegates base/sunken cadence to the view. LandingView and SectionedView plan automatic body grounds while preserving explicit inverse anchors. LandingView planning also accounts for trailing documents and its optional closing call to action.
- Add static Scene illustrations for document convergence, evidence trails and approval chains, with seeded geometry, complete linear HTML and caller-owned instance ids. Add structural, non-brandable scene tilt and linear card measure tokens.

## 0.7.1 - 2026-10-04

- Component entries read token data directly so browser bundlers do not traverse the token tools' Node-only imports.

## 0.7.0 - 2026-10-02

- `@clossys/designer/tokens` now exports `BackdropContract`, `checkBackdropContract` and `checkBackdropElement`, which check a hero backdrop's scrim contrast, `aria-hidden`, `pointer-events`, reduced-motion fallback frame, lazy-loading budget and focusable descendants. The scrim contrast is held to the light and the dark theme: the dark theme is read from a `darkTokens` registry the caller supplies, a theme-dependent token with no dark value of its own is reported as unchecked rather than passed, and a page that forces the light theme opts out with `themes: "light-only"`.
- A page on the `tokens.css` and `compiled.css` path now gets border-box sizing and inherited form-control fonts from a `foundry-ui-base` layer that comes before the utilities layer and that unlayered consumer CSS overrides.
- The second-binder scan now matches `--color-*` property names case-sensitively, so a property that differs only by case is no longer reported.
- The second-binder scan now ignores `//` line comments in `.postcss` stylesheets, as it does in `.pcss` and `.scss`.
- `designer-brand-check` now looks for the brand overlay at `brand/brand.css` by default, so a multi-application product no longer has to pass the path.
- `designer-brand-check` now exits 1 when any other `.css`, `.scss`, `.sass`, `.less`, `.pcss` or `.postcss` file under `apps/` (or `--apps <dir>`) declares a `--color-*` property, resets a colour family with `--color-*: initial` or `--color-red-*: initial`, or declares one in `@apply`, so an existing caller that has an `apps/` folder can now fail this check until it keeps one overlay.
- `Brandmark` accepts `plate="shared"` to draw one rounded-square plate behind the mark (default `"self"`, whose markup is unchanged), and the package exports `badgePlatePath(size)` with the shares `BADGE_RADIUS_SHARE` and `BADGE_INSET_SHARE` that describe the same plate geometry (#1535).
- `Brandmark`, exported from `@clossys/designer/shell` and `@clossys/designer/shell/server`, renders a home link named by a caller-supplied `label` around a decorative mark image and an optional live-text wordmark, sized by six new `--ui-brandmark-height-*` and `--ui-brandmark-gap-*` tokens.
- `composeLockup` no longer carries a source comment about passing its input whole to `adoptSuppliedMark`.
- `composeLockup`, exported from `@clossys/designer/tokens`, turns a supplied SVG mark, a wordmark string, a font-licence record and a `"mark"` or `"lockup"` header choice into a JSON-serialisable live-text lockup spec, and refuses a non-SVG mark, an empty wordmark or an unrecognised header or licence value with an `IdentityKitValidationError`.
- `@clossys/designer/blocks` exports `ConsentBanner`, a props-only region with a title, body, optional privacy-link slot and equal-prominence accept and reject buttons that holds no consent state and makes no storage or network call.
- Document the `--ui-width-display-max` token in the token reference and make the `ErrorView` README example a 500 page.
- The designer adds the `--ui-layout-drawer-w` (navigation drawer width) and `--ui-layout-tap-target` (44px minimum tap target) layout tokens, which the site chrome now reads instead of arbitrary values.
- The README's `ErrorView` section shows the diagnostic reference inline in `description` instead of a details slot and states that `action` holds one primary control.
- The Designer README now states where `Form` errors belong (inline under the field, or in the one `submitError` banner) and how multi-step forms that ask for an identifier first should navigate, with tests pinning the one-banner behaviour.
- `Form` now renders its error summary only when `errorSummaryMessage` is passed, and it no longer has a built-in heading text.
- Callers can pass `onSubmitError` to `Form` to receive the error when the promise returned by a validated `onSubmit` rejects, and `Form` now catches that rejection instead of leaving an unhandled promise rejection while the pending state clears.
- Callers can spread `useFormValidation`'s `getSubmitButtonProps()` onto the submit `Button` to show a focusable pending state while an async submit runs, and a second submit during that time does not call `onSubmit` again.
- Callers can pass `submitError` to `Form` to render one alert above the actions for a submission that failed to send.
- Adds the non-brandable `--ui-width-form-max` token (`38rem`), a content-column measure for single-form pages; the curated token set is now 168.
- `Link` accepts `buttonVariant` and `buttonSize` to render with exactly the classes `Button` applies for that variant and size, so a framework link element can look like a `Button` while staying a link; a `Link` with neither prop is unchanged.
- The Setup section of the README now says only the repository root declares `@clossys/designer`, and lists the `theme.css` and `utilities.css` entries among those a workspace package re-exports; the compiled CSS check's usage text names `styles/utilities.css`.
- The README Setup and skill now describe one `brand/designer.css` entry and one `@clossys/designer` dependency shared by every application of a product.
- `NavShell` indents the drawer panel's props consistently with the surrounding source.
- The README's `AuthView` section no longer repeats itself after the `Stat` section, and now documents `internalNote` and the legal-row-only footer rule.
- The `AuthView` section of the README now says the card holds only the form, that `secondaryAction` sits below it, and that an activation step never offers request-access or sign-up.
- The README now describes AuthView's site shell, with `brand` required.
- The Form standard in the Designer README gains an Error copy section on how to word a failure message, and the `AuthView` entry names the `isDisabled` exception to rendering the form as given.
- `recolorSvg`, and so `adoptSuppliedMark`'s `light`, `dark`, `mono`, `favicon` and `appIcon` variants, now knocks out a supplied mark when the whole document is a recognised flat two-tone mark (groups and basic shapes with explicit hex fills, two tones, every first-tone shape before every second-tone shape, no ids, references, styles, classes, text or root paint), so the surface shows through where one tone overlaps the other (#1537). Recognition is one linear pass capped at 32 attributes on a tag, 2000 elements and 32 groups deep; any other input, including one over a cap, is recoloured flat as in the previous release. The contrast check skips only `<mask>`s in the form `recolorSvg` emits.
- Callers can pass `errorSummaryMessage` on Form, `skipLinkLabel` on Shell, `tableFallbackLabel` on ChartFrame, BarChart, and LineChart, `barLabel` and `categoryColumnLabel` on BarChart, `overlayLabel` and `xColumnLabel` on LineChart, `tableFallbackLabel` and `valueColumnLabel` on Sparkline, `noResultsLabel`, `rangeSummaryMessage`, `pageSummaryMessage`, and `pageSizeLabel` on Pagination, `trendLabels` on Stat, `preferenceLabels`, `toggleLabel`, and `preferenceAnnouncement` on ThemeToggle, and `placeholder` on Select.
- `SiteFooter` accepts `ground="transparent"`, which renders the footer with no background class, no border class, no border width and no divider between its columns and secondary row, keeping the base ink.
- `SiteHeader` accepts `ground="transparent"`, which renders the header with no background class, no border class and no border width; like `base`, it sets no ink class.
- `SiteHeader` and `SiteFooter` accept `ground="transparent-inverse"`: no plate and no border, like `"transparent"`, with the on-inverse ink on the footer and its secondary row, for chrome over a page on the inverse ground.
- `SiteFooter.Legal` renders the copyright line and legal links in the footer's `secondary` slot from a caller-supplied `entity`, `links`, and optional `linksLabel`, with the year computed at render and the responsive layout handled by the component.
- `SiteHeader` accepts `navPlacement="centered"` to center its navigation between the brand and the trailing controls, and a `secondaryAction` slot rendered before `actions`.
- `SiteHeader` accepts an optional text-only `surfaceLabel`, such as "admin" or "demo", shown as a neutral non-interactive badge at the trailing end of the header in both nav placements.
- Callers can use the new `useFormValidation` hook with `Form` to validate a field on blur, re-validate a field that shows an error on change, re-validate every change after the first submit, and move focus to the first invalid field in document order when a submit fails.
- A shared CSS entry can now import `@clossys/designer/utilities.css`, a generated list of `@source inline(...)` directives for this package's component classes, instead of a path `@source` on `dist` and a hand-kept class list.
- Each package skill's section for when the package is not installed speaks of the repositories the team is set up in, instead of every inventoried repository.
- Each package skill says the whole team is composed in the hub and a repository staffed in an approved plan gets `@clossys-advisor` and the voices of the roles staffed there once that plan's setup pull request has merged, so a missing `@clossys-<package>` mention is a bug only in the hub.

## 0.6.0 - 2026-09-24

- The `foundry` manifest block now declares `capabilities` (manifest schema
version 3, #1196), a capability map of this role's craft with nine
capabilities. Five are `built`, each naming its own release-qualification
case as `proofCase` (#1272): the token contract and brand-overlay binding
(`brand-binding-clean`), token purity (`token-purity-clean`), contrast
(`contrast-clean`), the type record (`type-record-clean`), and structure and
fold conformance (`fold-clean`, also backed by the surface-ladder and
hero-CSS cases). Components and blocks is `partial` and cites
`surface-ladder-clean`: a route composed only from Designer atoms and
blocks passes, and a route that imports a second library's `atoms`,
`tokens`, or `theme` entrypoint beside Designer fails
(`surface:dual-primitive-stack`), but a second library imported any other
way (a package root, `/components`, or an unscoped path), a bespoke
element, or a surface that uses no Designer component at all is not caught
yet. Accessibility beyond contrast, brand-kit assembly, and logo and
identity files (#1210) are `planned`, with no proof case. For logo and
identity files, `generateIdentityDirections`, `adoptSuppliedMark`, and
`judgeIdentityKit` (from `@clossys/designer/tokens`) already generate and
check a variant set, but no command wires them to a checked output a
qualification case could run.
- The changelog no longer carries an empty "Unreleased" heading, so each release's entry sits directly under the introduction instead of above an empty section.
- The `foundry` manifest block now declares `outputs`
(`clossys/designer/brand.css`, the brand bindings, and
`clossys/designer/type-record.json`, the type record), `feeds` (the brand
overlay, fed by the `token-contract-and-brand-overlay-binding` capability),
and `fit`, which names a new shipped `fit-signal-declarations.json` with one
signal: the repository ships an interface surface a person sees. `intake`
and `status` are not declared yet. The README's API table now documents
`SectionFrame`, `SectionFrameProps`, and `SectionMeasure`.
- The `foundry` manifest block now declares `needs` and `solves` (package
framework, #1172). `needs` names Strategist's `brand-derivation`, which the
brand overlay binds to token slots. `solves` claims the
`designer-interface-quality` problem, measured by the design conformance
rate, backed by `token-purity` and shown by the `token-purity-violated`
case. Its evidence is `designed`: no retained qualification record covers
this version yet.
- The changelog is no longer included in the package; it now lives in the public repository, linked from the README.
- Remove the duplicated "How we work together" and "One question at a time"
sections from this package's packed skill (`skill/SKILL.md`).
`@clossys/launcher` injects the shared conversation contract when it
composes a skill for a consumer, so the packed skill no longer carries its
own byte-identical copy (#1182).
- Packed skill: cite the strategist handoff. writer cites an audience id,
approved claim ids (`claim:<id>`), applicable constraint ids
(`constraint:<id>`), and the current direction id, and never edits
`clossys/strategist/`. designer cites constraint ids and derived token slot names,
and never adds a brand attribute, color value, or type pairing inside
strategy records. customer speaks only from the audience
`situation`/`pains` Strategist recorded, never authors the audience
record, and does not inhabit until `strategist-check handoff` is green.
publisher seals against the projected strategy provenance
(`projectStrategyContract` / `createStrategyProvenance`) and never
authors strategy. Refs: #1120, #1121, #1122, #1123.
- Fix the remaining #1205 inconsistencies: Designer's and Writer's packed
skills now say they supply the tokens, atoms, blocks, and copy ids a
surface document cites by reference rather than co-authoring it, matching
Publisher's skill. Publisher's surface-ownership module no longer says the
shared consumer layout contract (#1171) has not landed; that contract now
names Publisher as the owner of `clossys/publisher/surfaces`. Launcher's
packed skill catalogue carries a copy of each role's skill, so it is
released alongside the skill edits (#1184).

## [0.5.0] - 2026-09-22

### Added

- Identity kit on `@clossys/designer/tokens` (closes #1210): deterministic
  logo generation and judgement without a hired designer. `generateIdentityDirections`
  builds three directions (a wordmark and two monogram shapes) from a brand
  name and resolved tokens; `adoptSuppliedMark` derives the same variant set
  from a client-supplied or human-designer SVG instead (`found` -> adopted).
  Every direction ships the seven-role variant set `primary`/`mark`/`mono`/
  `light`/`dark`/`favicon`/`appIcon`. `checkIdentityContrast`,
  `checkMinimumSize`, `checkClearSpace`, and `checkSingleColourLegibility`
  judge each variant, combined by `judgeIdentityKit` into a per-check
  `satisfied`/`violated`/`indeterminate` verdict — an indeterminate check
  never counts as a pass. A custom pictorial mark never blocks v0.
- Conformance rework (owner direction, issue #1187): `judgeIdentityKit`'s
  per-check and overall findings now use the shared `findingShape` (`{
  rule, severity, message, path? }`, new `IdentityFinding` type) the
  repository contract docs/contracts/check-output-envelope.json declares
  (that contract does not ship with this package) instead of a bare
  `detail: string` -- no local copy of the contract, and `verdict` was
  already the contract's own `satisfied`/`violated`/`indeterminate`
  vocabulary. `judgeIdentityKit` now also returns an overall `verdict` and
  flattened `findings` alongside its existing per-check `checks` and `ok`;
  any `indeterminate` check makes the overall verdict `indeterminate` too
  (fails closed), even alongside a `violated` one. New
  `identityKitReport(direction, tokens, version)` builds the full envelope
  document (`{ package, version, verdict, summary, findings, nextAction?
  }`). A new contract-conformance test
  (`src/tokens/check-output-envelope.test.ts`, a dev-only test not shipped
  with this package) reads the contract file directly and validates real
  report output against it. The prior review's SVG-attribute
  escaping/validation fix carries forward unchanged.

### Fixed

- Six CodeRabbit-found correctness gaps confirmed by independent review
  (issue #1320): `checkMinimumSize`/`checkClearSpace` now read
  `viewBox`/`data-clear-space` from the root `<svg>` START TAG only, never
  a whole-document string search — a nested `<svg>` or a descendant
  element's attribute can no longer satisfy either check when the root
  itself declares none. `checkIdentityContrast` now takes the direction's
  `kind`/`variants`, not just `tokens`: for an ADOPTED direction it checks
  the `primary`/`mark` variant's own actual rendered fill/stroke colour(s),
  not the (never-written-there) `ink` token, and is `indeterminate` — never
  silently `satisfied` — when no explicit colour can be found.
  `deriveInitials` now iterates by Unicode code point (`Array.from`), not
  UTF-16 code unit, so a name containing an astral character (most emoji)
  never produces a broken surrogate half. `isSvgDocument` now requires the
  closing `</svg>` to be the document's final non-whitespace content, not
  merely present somewhere in the string — `<svg>...</svg><script>...`
  is refused, not adopted. `recolorSvg` and `checkSingleColourLegibility`
  now share one paint-attribute pattern that matches a single-quoted or
  spaced `fill`/`stroke` attribute and never mistakes `data-fill` for one.
  `wrapBadge` (the `appIcon` variant) now scales and centres the source
  mark's own viewBox into the fixed `0 0 48 48` badge instead of dropping
  it in unscaled and top-left-aligned; a generated mark (already drawn in
  that same viewBox) gets an identity transform, unchanged. README:
  corrected the claim that `primary` is "ink-coloured" for every
  direction — only true for a GENERATED one; an ADOPTED `primary`/`mark`
  keeps the supplied SVG's own colours.

## [0.4.17] - 2026-09-21

### Added

- Master brand mark contract on `@clossys/designer/tokens`: `MasterMark`
  (lockup, mark-only, and inverse SVG documents), `validateMasterMark`,
  and `iconMarkSvg` aligned with the `Icon` atom and design tokens (closes
  #1109). This package does not ship a product logo.

### Changed

- README: state that `designer-environment-check` is an internal-consistency
  check with no close condition; contract-level exemption slot blocked on
  issue #906 (closes #447).

## [0.4.16] - 2026-09-21

### Added

- `SectionFrame` block: full-bleed marketing section with `ground`, `measure`
  (`content` | `wide` | `prose`), page padding, and a measured inner column.
  Long-form and stat compositions render inside it instead of host `className`
  wrappers (`data-designer-section-frame` marks framed regions).
- `ground` on `SiteFooter`, `SiteHeader`, `Shell.Header`, and `Shell.Footer`
  (`base` | `inverse`) — inverse plates use the same surface/ink tokens as
  grounded content blocks.

### Changed

- `ArticleBody` no longer sets its own max width; measure comes from
  `SectionFrame` (`measure="prose"`). Marks `data-designer-requires-section-frame`.
- Replaced 15 physical inline-direction utilities in `atoms/` and `blocks/`
  with logical equivalents for correct RTL layout (#951).

## [0.4.15] - 2026-09-21

### Changed

- Packed skill: expression-wave ownership — greyscale token contract,
  consumer brand overlay binding, and with Writer the in-tree page document;
  do not invent a brand against derivation law, treat Publisher as the
  assembler, or seal surfaces.
- Packed skill: name `MarketingView`, `SectionedView`, or a registered
  web template before filling bands; do not author a page shape the
  shipped views cannot hold. Refs: #1027.

## [0.4.12] - 2026-09-21

### Added

- `theme-keys.css` export: Tailwind `@theme` utility keys without `:root`
  primitives — for consumers who already ship a token root (issue #1051).
- `getAuthoredThemeInitScript()` stamps the authored day register before
  first paint; `getStoredThemeInitScript()` is the opt-in OS/storage path
  for product chrome (issue #1065).
- `MarketingChapter` block: marketing-scale chapter titles (`text-h2`) with
  a prose slot (issue #1058).
- `Hero` `composition` prop (`editorial` default, `split` opt-in): passing
  `media` no longer implies a two-column product-shot layout (issue #1062).
- `designer-environment-check surface [scan-dir]`: fails dual primitive
  stacks, dual Designer CSS roots, and marketing `SectionHeader` misuse
  (issues #1055, #1060).
- Display signature tokens (`--font-display-style` through `--font-display-scale-x`,
  `--ui-width-display-max`)
  and `max-w-display` utility; display headings cap measure without host CSS
  copies (issue #1052).

### Changed

- `Hero` display headings use the packaged display signature and measure cap.

## [0.4.11] - 2026-09-21

### Changed

- PRE-AUTH-QUALITY: bounded taste pass after floor gates are green — `designer-fold-check` precondition, screenshot inputs, separate session from the doer, at most 3 inhabit rounds or 45 minutes wall clock, no doer self-certify of exceptional keep. Deliverability of good (3) stays fixtures and CLIs, not longer skills.
- Packed `clossys-designer` skill Pre-auth section points at that contract (Writer and Publisher skills updated in-tree; pack on their next bumps).

## [0.4.10] - 2026-09-21

### Added

- Ships the packed Agent Skill in the tarball (`files` includes `skill`).

## [0.4.9] - 2026-09-21

### Added

- `@clossys/designer/tokens` re-exports `checkTypeRecord`, `parseTypeRecord`,
  `checkTypeRecordOverlay`, and the brand-type record types so consumers can
  validate an authored type brief without importing `src/type-record/` paths.

## [0.4.8] - 2026-09-20

### Added

- `PRE-AUTH-QUALITY.md`: star scale (3 good / 4 great / 5 exceptional); done is 5; gates prove 3 only. Exceptional is a synthetic user, first person, fresh look — not a Designer or Writer self-review, not a Publisher seal, not a QA checklist.
- `designer-hero-css-check` bin: fails when a built stylesheet is missing
  Hero/Button utility rules (`text-display-l`, `font-display`, `bg-accent`,
  `rounded-control`, `tablet:grid-cols-2`).
- `designer-fold-check` bin: validates fold measurement JSON (H1 not clipped,
  no overlays on the fold, exactly one primary CTA, closed `heroMediaKind`);
  `--also` for an additional viewport file.
- `designer-type-check` bin, `templates/brand-type.template.json`, and the
  brand-type record schema (`--overlay` requires non-empty `--font-display`).
- `designer-brand-check --also <path>`: refuses when an extra stylesheet
  redeclares a brandable slot with a different value than the overlay.

### Changed

- `styles/compiled.css` is generated from `src/atoms/`, `src/blocks/`, and
  `src/shell/` so the default `tokens.css` + `compiled.css` path styles
  pre-auth Hero and shell without Tailwind.

## [0.4.7] - 2026-09-19

### Fixed

- Removed a stray comment-terminator sequence (`*/`) from CSS comment
  text in `styles/tokens.css`. A comment listing token families read
  `--color-surface-*/--color-ink-*`; the `*/` inside it terminated the
  comment early, so the rest of the comment block was parsed as
  declarations and broke the file for strict CSS parsers (Turbopack).
  Rewritten as `--color-surface-* or --color-ink-*` in both affected
  comments; no token name, value, or meaning changed.

## [0.4.6] - 2026-09-18

### Added

- Documented installation against the public npm registry
  (`https://registry.npmjs.org`) and that installing needs no authentication.
- Stated the charter close condition in the README: independent consumer
  evidence of `design conformance rate`, computed by
  `assessDesignConformanceRate()`. An empty evaluated set is
  indeterminate, never a perfect rate of 1. `designer-token-check`,
  `designer-brand-check`, `designer-contrast-check`, and
  `designer-environment-check` remain the gates they are; none is this
  rate.
- Declared `foundry.assessment` against a new mapped `designer-rate-check`
  bin with `invocation: "single-json-input"`. The four existing designer
  bins remain gates and are not the assessment surface. Advisor remains
  the only required first-day role.
- `designer-rate-check assessment.json`: prints the `design conformance
  rate` report and exits on the `0` / `1` / `2` ternary.

### Notes

- This does not claim the position is closed. Qualification of `0.4.6` is
  deferred under #833.

## [0.4.5] - 2026-09-16

### Fixed

- `DataTable`'s loading-skeleton row (`SkeletonCell`, in
  `blocks/DataTable.tsx`) rendered its `animate-pulse` class with no
  `motion-reduce:animate-none` override — the one miss in an otherwise
  consistently-followed convention (`atoms/Skeleton.tsx`,
  `atoms/ProgressBar.tsx`, and every other motion-bearing class in this
  package already pair the two). A consumer with `prefers-reduced-motion:
  reduce` set saw a pulsing skeleton row on every `DataTable` in a loading
  state. `SkeletonCell` now carries `motion-reduce:animate-none` like
  every other animated class this package ships.
- `README.md`'s "Optional-peer version guards" section claimed, unqualified,
  that "every atom accepts a `className` prop." `FileTrigger` does not, by
  design (react-aria-components' own `FileTrigger` hardcodes its hidden
  input's `className` to `""` and discards whatever is passed — see
  `FileTrigger.tsx`'s own header) — and the README already documented that
  exception correctly everywhere else. Only this one unqualified line
  contradicted it; it now names the exception instead of overclaiming.

### Changed

- `public-contract.test.ts`'s reduced-motion test asserted "every shipped
  animation or transition" but checked that claim against a hand-written
  list of ten files — a list that cannot notice a new motion site, which
  is exactly how the `DataTable` gap above shipped unnoticed (the same
  mechanism #907 is about). The test now scans `src/{atoms,blocks,shell,
  charts,theme}` for `animate-`/`transition-` class literals and checks
  every file it finds, the same file-discovery pattern `ladder.test.ts`
  and `peer-guard-coverage.test.ts` already use elsewhere in this package.
- `peer-guard-coverage.test.ts`'s `react`-peer coverage test (#182) checked
  a hand-written array of five `*/index.ts` barrels only. Designer has
  nine real `assertPeerVersion` call sites, not five: each `*/server.ts`
  is its own `exports` subpath (`@clossys/designer/charts/server`, etc.)
  a consumer can import without ever loading its sibling `index.ts`, so a
  guard wired only into `index.ts` left four call sites completely
  unpinned. The barrel set is now derived from `package.json#exports`
  itself and checked against built `dist/` output — what a consumer
  actually resolves — rather than `src/`. `theme/server.ts` deliberately
  ships no guard (`getThemeInitScript` has no runtime `react` dependency
  at all); the new test confirms that by reading dist rather than special-
  casing the file path out of its coverage. Designer's half of #903.

## [0.4.4] - 2026-09-15

### Fixed

- The internal `cx()` class-merge helper — reachable from every atom, and
  therefore from the server-safe barrels (`atoms/server`, `blocks/server`)
  too — used to `import` `tailwind-merge` STATICALLY. `tailwind-merge` is
  declared an OPTIONAL peer in this package's own `peerDependenciesMeta`,
  so a consumer who (correctly) did not install it got
  `Cannot find package 'tailwind-merge'` the moment any server-safe import
  touched `cx`, even on a render path that never mentioned styling. `cx`
  now resolves `tailwind-merge` via a dynamic import inside a `try`/`catch`,
  so importing a subpath no longer throws on this peer's absence, and
  still uses the full token-aware merge whenever it is installed. See
  `atoms/internal/cx.ts` and `atoms/internal/cx.optional-peer.test.ts`
  (#749).

### Changed

- When `tailwind-merge` is genuinely absent, `cx()` renders with a plain,
  unmerged class join instead of resolving conflicts — two conflicting
  Tailwind utilities passed to the same `cx(...)` call (a built-in default
  and a consumer's own override, say) are now BOTH present in the
  rendered `className`, and which one is visually applied depends on
  Tailwind's generated stylesheet order rather than on argument order.
  This is not silent: `cx()` logs one `console.warn` per process (not per
  call) the first time it actually happens, naming the cause. See the
  README's "Optional-peer version guards" section.

## [0.4.3] - 2026-09-14

### Changed

- Patch version bump only, to obtain a fresh, never-before-used
  `governance/release-qualifications/` record path. The 0.4.2 qualification
  record added by #811 was orphaned when that pull request was squash-merged
  (#821) and had to be removed (#834); the immutability gate that protects
  already-introduced record paths (`check-candidate-qualification.mjs`'s
  single-introduction-commit invariant) means a valid record can never again
  be introduced at the `0.4.2` path, so this package moves to `0.4.3`
  purely to regain one. No functional or behavioral change.


## [0.4.2] - 2026-09-09

### Changed

- Historical entries below now describe the previous npm scope without naming
  the producer account this catalogue no longer publishes under, and links to
  this repository use its current `clossys/foundry` path. No date, version,
  or recorded fact changed — only the way the retired scope is referred to.


## [0.4.1] - 2026-09-02

### Changed

- Named Clossys as copyright holder in `LICENSE` and as `author` in the
  package manifest, so every package in the catalogue attributes identically.


## [0.4.0] - 2026-09-02

### Added

- Made `StatusList`'s `groups` prop optional and added a sibling `items`
  prop: a flat array of the same row shape, rendered as a single `dl` with
  no group heading at all. Provide exactly one of the two. A grouped list
  (`groups`) renders exactly the markup it always did — one heading and one
  `dl` per group — so this is additive for every existing caller; `items` is
  the only new rendering path.

## [0.3.1] - 2026-09-01

### Fixed

- Declared the four CLI bin targets in the form npm actually publishes, without
  a leading `./`. npm rewrote those values during packing, so the manifest in
  the tarball disagreed with the manifest in the tree and publish qualification
  refused the candidate. The normalised values are byte-identical to what
  0.2.7 already carries on the registry, so no installed CLI path moves.

### Note on 0.3.0

0.3.0 was never published. It carried the additive SectionedView slots below
and was withdrawn before release when the bin-map defect was found. Everything
0.3.0 added ships in 0.3.1 unchanged; the number is skipped rather than reused
because a released version is immutable and this candidate's packed contents
changed after qualification.

## [0.3.0] - 2026-09-01

### Added

- Added an optional `detail` slot to every `StatusList` row, readiness and
  off-axis disposition alike. It renders as a second description of the same
  term, so a row's own explanation, including the reasoning behind a
  `not-offered` answer, stays inside the definition-list semantics rather than
  becoming a paragraph that only looks adjacent. A row had nowhere to put that
  reasoning before but its own label.
- Added the optional `eyebrow` slot `Hero` and `FeatureGrid` already shipped
  to `Faq` (both the React Aria and server-native implementations),
  `OrderedStepSequence`, and `StatusList`. A small label above the block
  heading is now expressible on every editorial block rather than on two of
  them. A block given no eyebrow, heading, or description still renders no
  heading region at all.

Both slots are optional and additive: a call that compiled and rendered under
0.2.7 compiles and renders identically under 0.3.0, and a block passed neither
slot emits the markup it always did. This is a minor rather than a patch
because 0.x caret and tilde ranges are minor-locked, so a consumer that wants
either slot widens its declared range deliberately.

## [0.2.7] - 2026-09-01

### Added

- Added the separately closed `StatusList` `not-offered` disposition for
  deliberate non-capabilities outside the readiness axis. It uses a neutral
  tone rather than reading as a warning or future commitment.

## [0.2.6] - 2026-08-31

### Added

- Added server-safe `OrderedStepSequence` and `StatusList` editorial blocks
  with ordered and definition-list semantics, caller-localized labels,
  closed state and ground vocabularies, accessible authored ordinals,
  responsive decorative connectors, and explicit contrast coverage.
- Added the server-safe, closed `SectionGround` contract (`base`, `sunken`,
  `inverse`) and Designer-owned class/token mapping. `Hero`, `FeatureGrid`,
  both `Faq` implementations, `OrderedStepSequence`, and `StatusList` now
  apply their own matching surface, foreground, divider/connector, and status
  treatment rather than requiring a consumer to paint around them.

### Fixed

- Replaced the five bounded physical-direction shell patterns with logical
  inset, border, and focus-position utilities so navigation, drawers, toasts,
  and skip links follow the document writing direction.

## [0.2.5] - 2026-08-31

### Changed

- Prepared a bounded trusted-publisher patch source for provenance after the owner-present first publication and anonymous registry verification. This change does not publish the package or claim provenance.

## [0.2.4] - 2026-08-31

### Fixed

- Added `Faq` to `@clossys/designer/blocks/server` with a native
  `details`/`summary` implementation. The ordinary blocks entry continues to
  use React Aria, while server consumers receive the same public props without
  reaching the client-only dependency graph. The native summary retains its
  stateful disclosure marker and uses the package-standard focus-visible
  outline without the `outline-none` custom-property override that would
  prevent Tailwind's generated outline width from painting. The same
  conflicting reset was removed from Banner's dismiss control.

## [0.2.3] - 2026-08-30

### Changed

- Updated the package's public repository, issue-tracker, and homepage metadata to the canonical Foundry repository. This change is not a publication or qualification claim.

## [0.2.2] - 2026-08-29

### Security

- Replaced three backtracking token parsers with deterministic scanners so
  hostile malformed OKLCH, token-alias, and CSS-comment input is handled in
  linear time without changing valid parsing behavior.

## [0.2.1] - 2026-08-24

### Fixed

- Updated README guidance to active Publisher and Writer packages after the
  predecessor packages retired.

## [0.2.0] - 2026-08-21

### Added

- **The `environment-conformance` gate**, closing
  [issue #405](https://github.com/clossys/foundry/issues/405) as
  narrowed by that issue's own correction comment once
  [issue #358](https://github.com/clossys/foundry/issues/358) routed
  the full module-graph resolver elsewhere: `render-environment.ts` has
  exported `RENDER_ENVIRONMENT` — a plain record declaring each
  `package.json#exports` subpath `"server-safe"` or `"client-only"` — since
  this package's first release, but nothing ever verified it stayed in step
  with the manifest it describes. A subpath could be added to, removed
  from, or renamed in `package.json#exports` with no matching edit to the
  record, or vice versa, and nothing would notice.
  - **`checkEnvironmentConformance(packageRoot)`** (new export from
    `@clossys/designer/gate`) checks that `RENDER_ENVIRONMENT`'s key
    set and `package.json#exports`' subpath set are the SAME SET, in both
    directions — nothing more. It performs NO module resolution and does
    not verify that a `"server-safe"` subpath actually resolves safely
    under a real export condition; that real verification is
    [issue #358](https://github.com/clossys/foundry/issues/358)'s
    shared `builder` capability, deliberately not built twice here. A
    `"satisfied"` verdict means the declaration is internally consistent
    with the manifest — it says nothing about whether the declaration is
    true of the compiled output. Returns a three-state verdict:
    `"satisfied"` (the two sets agree, over at least one subpath, never
    "no error was thrown"), `"violated"` (every `undeclared-subpath` and
    every `stale-declaration` reported, each naming its own direction, not
    collapsed into one "mismatch"), or `"indeterminate"` with a
    machine-readable reason (manifest missing/unparseable, no or an empty
    `exports` map, the declaration missing/unparseable, or the
    declaration-loading subprocess failing).
  - **`designer-environment-check [package-dir]`**, a new installable
    `bin`, exits `0`/`1`/`2` for satisfied/violated/indeterminate.
  - **The adversarial proof this gate is built to pass, asserted in one
    test over one fixture** (`environment-conformance.adversarial.test.ts`):
    the named weaker tool — a bare COUNT comparison, "N keys on each side,
    so they must agree" — exits `0` on a fixture where one subpath was
    RENAMED (never added or removed), because the count is unchanged on
    both sides. The real gate, spawned as the compiled CLI by its compiled
    path (the same way this repository invokes every gate), exits `1` on
    the identical fixture, because the renamed-to name is undeclared and
    the renamed-from name is now a stale declaration — a defect a count
    can never see.

## [0.1.0] - 2026-08-21

First release. This package is the designer role, recut from
the previous scope's `ui` package per
[decision 10](../../docs/DECISIONS.md#10-recutting-the-expression-surface-into-role-shaped-packages).

This changelog starts here rather than carrying the donor's history, which
cites decisions and issues that would mean nothing — or the wrong thing — to a
reader who arrives at this package first.

### Added

- A complete visual system: design tokens, theme CSS, accessible React
  components (`atoms`, `blocks`, `shell`, `charts`, `theme`), icon glyph data,
  and three visual-quality gates — unchanged from the donor.
- **The published tarball carries this changelog.** `files` includes
  `CHANGELOG.md`, following the convention the operation packages adopted in
  #417. A consumer reading the installed package should not have to leave it
  to find out what changed; a new package should be born with the current
  convention rather than inheriting its donor's gap.

### Changed from the previous scope's `ui`

- **The package is named for the job, not the artifact.** The role's
  exclusive question is *is it well made?* A name that describes a thing
  rather than a doer is an artifact, and an artifact belongs inside a role.
- **All three bins are renamed for the role, not the artifact:**
  - `ui-token-check` → `designer-token-check` (the CLI for `checkTokenPurity`)
  - `tokens-brand-check` → `designer-brand-check` (the CLI for
    `checkBrandFileCoverage`)
  - `ui-contrast-check` → `designer-contrast-check` (the CLI for
    `checkTokenContrast`)

  Each keeps the `<role>-<job>-check` shape the donor already used
  (`ui-token-check`, `ui-contrast-check`) or is brought into it
  (`tokens-brand-check` was named for the layer it lives in, `tokens/`, not
  the role that runs it); only the leading segment moves from the artifact
  name to the role name. The job words after the dash — `token`, `brand`,
  `contrast` — are domain vocabulary the gates actually check and are left
  alone, matching decision 10's rule that renaming the role does not rename
  what it reasons about.
- **Nothing else was renamed.** `tokens`, `atoms`, `blocks`, `shell`,
  `charts`, `theme`, `RENDER_ENVIRONMENT`, `checkTokenPurity`,
  `mergeUiClasses`, and every other exported symbol, CSS custom property, and
  file name keep their names. A sweep that also renamed the vocabulary would
  have made the diff unreviewable while changing no behaviour.
- **The peer-version guard's source comment is strengthened, not just
  copied.** `internal/peer-version.ts` mirrors the donor's local ternary
  (never imported from `@clossys/controller`) exactly, but its header
  now records both reasons that copy must stay a copy — this package sits at
  or below `@clossys/controller` in build order, and `controller`
  itself cannot re-export the type because `gates/secret-gates.ts` already
  imports its own `internal/peer-version.js`, which would create a cycle —
  and states plainly that consolidating the (now six) identical copies into
  one shared import is a regression, not cleanup. The guard's own behaviour,
  including its deliberate fail-open inversion of this repository's
  fail-closed gate contract and the named cost that buys (a genuinely
  incompatible peer whose version string cannot be parsed proceeds silently),
  is unchanged from the donor.

### Not included

> **Current lifecycle note:** the previous scope's `ui` is now retired. This
> release note records its state at 0.1.0; the lifecycle contract is the
> authority for current availability.

- **No forwarding stub in the donor.** The previous scope's `ui` is
  deprecated-and-retained: still installable for a consumer already pinned to
  it, with no re-export pointing here. A stub would keep the old name
  importable, and a supersession check could then never reach zero — the
  forwarding layer would defeat the gate built to prove the swap completed.
